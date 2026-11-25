// Passkeys from a phone (Electron has no WebAuthn UI: a page's request would wait forever). The page hands it here
// (passkeys-preload.cjs), the window shows a QR code, the phone answers over hybrid.ts. macOS: ble.swift hears it.
import { app, ipcMain, type IpcMainInvokeEvent, type Session, type WebFrameMain } from "electron"
import { execFile, spawn, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"
import { eachPage, eachSession, handle, tell, type EnginePage, logger } from "./engine.ts"
import { newKey, publicOf, qrText, run, type Progress } from "./hybrid.ts"
import { prepareCreate, prepareGet, readCreate, readGet, WebAuthnError, type Caller, type Prepared } from "./webauthn.ts"
import { z } from "zod"
import { messageOf } from "./messageof.ts"

const log = logger("passkeys")

const PRELOAD = fileURLToPath(new URL("./passkeys-preload.cjs", import.meta.url))
const SWIFT = fileURLToPath(new URL("./ble.swift", import.meta.url))
/** How long a request waits for the phone: the page's own timeout, but never so short there's no time to scan. */
const MIN_MS = 120_000, MAX_MS = 600_000

/** What the window shows over a page while its request waits (`state` "done": nothing). */
type State = Progress | "bluetooth-off" | "bluetooth-denied" | "unavailable" | "done"
type Ask = { n: number; page: EnginePage; frame: WebFrameMain; abort: AbortController; qr: string; site: string; create: boolean }
const FRAME_SAID = z.object({ policyAllows: z.boolean().nullable(), userClicked: z.boolean() })
const ASKED = z.tuple([z.string(), z.string().max(64_000), FRAME_SAID])
type Asked = { create: boolean; json: string; said: z.infer<typeof FRAME_SAID> }
/** The request each page waits on, by the page's id: one at a time, as in a browser. */
const asks = new Map<number, Ask>()
let lastAsk = 0

const pages = new Map<number, EnginePage>() // by their contents' id
const sessions = new Set<Session>()
if (process.platform === "darwin") {
  eachPage((p) => {
    const id = p.wc.id
    pages.set(id, p)
    const stop = () => asks.get(p.id)?.abort.abort(new WebAuthnError("NotAllowedError", "The page went away."))
    p.wc.on("did-start-navigation", (d) => { if (!d.isSameDocument && (d.isMainFrame || d.frame === asks.get(p.id)?.frame)) stop() })
    p.wc.once("destroyed", () => { stop(); pages.delete(id) })
  })
  eachSession((s) => {
    sessions.add(s)
    s.registerPreloadScript({ type: "frame", filePath: PRELOAD })
  })
}

const show = (a: Ask, state: State) => tell(a.page.win, { type: "engine:passkey", id: a.page.id, tab: a.page.tab(), ask: a.n, state,
  qr: state === "scan" ? a.qr : "", site: a.site, create: a.create })

ipcMain.handle("vaultite:passkey", async (e, ...given: unknown[]) => {
  try {
    const asked = ASKED.safeParse(given)
    if (!asked.success) throw new WebAuthnError("TypeError", "Bad options.")
    const [kind, json, said] = asked.data
    return JSON.stringify({ ok: await request(e, { create: kind === "create", json, said }) })
  } catch (err) {
    const w = err instanceof WebAuthnError ? err : new WebAuthnError("NotAllowedError", "The operation either timed out or was not allowed.")
    if (!(err instanceof WebAuthnError)) log.error("a passkey request failed", err)
    return JSON.stringify({ error: { name: w.name, message: w.message } })
  }
})
ipcMain.on("vaultite:passkey:cancel", (e) => {
  const p = pages.get(e.sender.id), a = p && asks.get(p.id)
  if (a && a.frame === e.senderFrame) a.abort.abort(new WebAuthnError("AbortError", "The operation was aborted."))
})
handle("passkey:cancel", (win, n) => {
  for (const a of asks.values()) if (a.n === n && a.page.win === win) a.abort.abort(new WebAuthnError("NotAllowedError", "The user cancelled."))
})

/** As Chrome: a frame not same-origin with its ancestors asks only by its embedder's allow=, and creates after a click. */
function callerOf(frame: WebFrameMain, { create, said }: Asked): Caller {
  const above = [...ancestors(frame)], crossOrigin = above.some((f) => f.origin !== frame.origin)
  if (said.policyAllows === false || (said.policyAllows === null && crossOrigin)) {
    throw new WebAuthnError("NotAllowedError", `The 'publickey-credentials-${create ? "create" : "get"}' feature is not enabled in this document.`)
  }
  if (create && crossOrigin && !said.userClicked) throw new WebAuthnError("NotAllowedError", "A frame from another site makes a passkey only right after a click.")
  return crossOrigin ? { origin: frame.origin, topOrigin: above[above.length - 1].origin } : { origin: frame.origin }
}
function* ancestors(frame: WebFrameMain) {
  for (let f = frame.parent; f; f = f.parent) yield f
}

async function request(e: IpcMainInvokeEvent, asked: Asked) {
  const p = pages.get(e.sender.id), frame = e.senderFrame, { create, json } = asked
  if (!p || !sessions.has(e.sender.session) || !frame || frame.top !== e.sender.mainFrame) throw new WebAuthnError("NotAllowedError", "This frame can't use passkeys.")
  if (!p.visible()) throw new WebAuthnError("NotAllowedError", "The document is not focused.")
  const caller = callerOf(frame, asked)
  if (asks.has(p.id)) throw new WebAuthnError("OperationError", "A request is already pending.")
  let options: unknown
  try { options = JSON.parse(json) } catch { throw new WebAuthnError("TypeError", "Bad options.") }
  const prepared: Prepared = create ? prepareCreate(options, caller) : prepareGet(options, caller)
  const secret = crypto.randomBytes(16), identity = newKey()
  const a: Ask = { n: ++lastAsk, page: p, frame, abort: new AbortController(), site: prepared.rpId, create,
    qr: qrText({ identity: publicOf(identity, true), secret, type: prepared.type }) }
  asks.set(p.id, a)
  const ms = Math.min(MAX_MS, Math.max(MIN_MS, prepared.timeout ?? 300_000))
  const timer = setTimeout(() => a.abort.abort(new WebAuthnError("NotAllowedError", "The operation either timed out or was not allowed.")), ms)
  try {
    const answer = await run({ secret, identity, command: prepared.command, signal: a.abort.signal, progress: (s) => show(a, s),
      adverts: (on) => listen(on, (s) => show(a, s)) })
    return create ? readCreate(answer, prepared) : readGet(answer, prepared)
  } finally {
    clearTimeout(timer)
    asks.delete(p.id)
    show(a, "done")
  }
}

// ---------- Bluetooth: ble.swift, running while some request listens ----------

type Listener = { advert: (a: Uint8Array) => void; state: (s: State) => void }
const listeners = new Set<Listener>()
let ble: ChildProcess | null = null
let bleState: State | null = null

function listen(advert: Listener["advert"], state: Listener["state"]) {
  const l = { advert, state }
  listeners.add(l)
  if (bleState && bleState !== "scan") state(bleState)
  if (!ble) void start()
  return () => {
    listeners.delete(l)
    if (!listeners.size && ble) { ble.stdin?.end(); ble = null; bleState = null }
  }
}

async function start() {
  let bin: string
  try { bin = await binary() } catch (e) {
    log.error(messageOf(e))
    for (const l of listeners) l.state("unavailable")
    return
  }
  if (!listeners.size || ble) return
  const child = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] })
  ble = child
  child.on("error", () => { if (ble === child) { ble = null; for (const l of listeners) l.state("unavailable") } })
  child.on("exit", () => { if (ble === child) ble = null })
  readline.createInterface({ input: child.stdout! }).on("line", (line) => {
    if (ble !== child) return
    if (line.startsWith("advert ")) {
      const a = Buffer.from(line.slice(7), "hex")
      for (const l of listeners) l.advert(a)
    } else if (line.startsWith("state ")) {
      const s = line.slice(6)
      bleState = s === "on" ? "scan" : s === "off" ? "bluetooth-off" : s === "unauthorized" ? "bluetooth-denied" : "unavailable"
      for (const l of listeners) l.state(bleState)
    }
  })
}

/** The listener's binary, compiled from its source the first time (and after it changes), as electron/apps.ts does. */
async function binary() {
  const src = fs.readFileSync(SWIFT)
  const out = path.join(app.getPath("userData"), "bin", `ble-${crypto.createHash("sha1").update(src).digest("hex").slice(0, 12)}`)
  if (fs.existsSync(out)) return out
  fs.mkdirSync(path.dirname(out), { recursive: true })
  // (built beside it, then moved in: a build cut off midway never leaves a binary that's reused)
  const tmp = `${out}.${process.pid}`
  await new Promise<void>((ok, fail) => execFile("/usr/bin/swiftc", ["-O", SWIFT, "-o", tmp], { timeout: 300_000 }, (e, _o, err) =>
    e ? fail(new Error(`Couldn't build the Bluetooth listener for passkeys (it needs Xcode's Command Line Tools): ${err || e.message}`)) : ok()))
  fs.renameSync(tmp, out)
  return out
}
