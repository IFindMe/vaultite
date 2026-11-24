import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { freePort, sleep } from "../lib.ts"
import type { Any, VaultTest } from "./harness.ts"

type Check = VaultTest["check"]


async function notice(check: Check) {
const { MISSED, missedText, noticeOf } = await import("../../../plugins/core/mcp/missed.ts")
  const at = (h: number, m: number, day = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + day); return d.toISOString() }
  const today = { since: at(2, 10), until: at(7, 45), total: 40, apps: { Claude: 40 } }
  check("away: the notice names the app, the count and when, in this machine's time; Mac only on macOS",
    missedText(today, "Mac") === "Claude tried to reach this Mac 40 times while it was asleep or offline (02:10–07:45)"
    && missedText(today, "computer").includes("this computer 40 times"), missedText(today, "Mac"))
  check("away: several apps most first, the unnamed as other apps; another day's says the day",
    missedText({ ...today, apps: { ChatGPT: 2, Claude: 30, other: 8 } }, "Mac").startsWith("Claude, ChatGPT and other apps tried")
    && missedText({ ...today, apps: { other: 5 } }, "computer").startsWith("Apps tried")
    && /\(\w{3} \d+, 02:10–07:45\)$/.test(missedText({ ...today, since: at(2, 10, -2), until: at(7, 45, -2) }, "Mac"))
    && /\(\w{3} \d+ 23:10 – \w{3} \d+ 07:45\)$/.test(missedText({ ...today, since: at(23, 10, -1) }, "Mac")))
  check("away: a couple of misses is noise, not told", noticeOf({ ...today, total: 2 }, "Mac") === null && noticeOf({ ...today, total: 3 }, "Mac")?.includes("3 times"))
  check("away: a frame that isn't one is refused", !MISSED.safeParse({ t: "missed", since: "x", until: today.until, total: 4, apps: {} }).success
    && !MISSED.safeParse({ t: "missed", since: today.since, until: today.until, total: -1 }).success && MISSED.safeParse({ t: "missed", ...today, apps: "junk" }).data?.total === 40)
}

async function frame(check: Check) {
  const { WebSocketServer } = await import("ws")
  const { Cloud } = await import("../../../plugins/core/mcp/cloud.ts")
  const port = await freePort()
  const wss = new WebSocketServer({ port, host: "127.0.0.1" })
  await new Promise((r) => wss.once("listening", r))
  const relay = `http://127.0.0.1:${port}`
  const frames = [{ t: "future", x: 1 }, { t: "missed", since: "never", until: "x", total: 3 }, { t: "missed", since: "2026-11-23T02:10:00.000Z", until: "2026-11-23T07:45:00.000Z", total: 41, apps: { Claude: 40, other: 1 } }]
  wss.on("connection", (ws) => ws.on("message", (m) => { if (JSON.parse(String(m)).t === "hello") for (const f of frames) ws.send(JSON.stringify(f)) }))
  const cfg: Any = { mcp: { cloud: { token: "t", handle: "alice", url: "https://alice.vaultite.app" } } }
  const cloud = new Cloud({ secrets: () => cfg, saveSecrets: () => {} }, async () => 1, relay)
  const heard: Any[] = []
  cloud.onMissed = (m) => heard.push(m)
  cloud.start()
  const t0 = Date.now()
  while (!heard.length && Date.now() - t0 < 5000) await sleep(20)
  check("away: the relay's missed frame reaches the app parsed, a broken one and an unknown frame ignored",
    heard.length === 1 && heard[0].total === 41 && heard[0].apps.Claude === 40 && cloud.status().state === "connected", { heard, state: cloud.status() })
  cloud.stop()
  wss.close()
}

async function holder(check: Check) {
  const { holderFor, KeepAwake } = await import("../../../plugins/core/mcp/awake.ts")
  const none = { battery: () => false, has: () => true }
  check("keep awake: macOS holds caffeinate -s (AC power only), ending with this server",
    JSON.stringify(holderFor("darwin", 42)) === JSON.stringify({ cmd: "/usr/bin/caffeinate", args: ["-s", "-w", "42"] }))
  check("keep awake: Linux blocks sleep with systemd-inhibit only without a battery; Windows has none",
    holderFor("linux", 42, none)?.cmd === "systemd-inhibit" && holderFor("linux", 42, none)!.args.includes("--pid=42")
    && holderFor("linux", 42, { ...none, battery: () => true }) === null && holderFor("linux", 42, { ...none, has: () => false }) === null && holderFor("win32", 42) === null)
  const started: Any[] = []
  const fakeChild = () => { const c: Any = new EventEmitter(); c.exitCode = null; c.signalCode = null; c.kill = () => { c.signalCode = "SIGTERM"; c.killed = true }; started.push(c); return c }
  const awake = new KeepAwake(() => ({ cmd: "/usr/bin/caffeinate", args: [] }), fakeChild)
  awake.set(true); awake.set(true)
  check("keep awake: one holder while it's wanted", started.length === 1 && awake.holding)
  awake.set(false)
  check("keep awake: ended when it isn't", started[0].killed && !awake.holding)
  awake.set(true)
  started[1].emit("exit", 1, null)
  awake.set(true)
  check("keep awake: one that ended on its own says so and isn't started again in a loop", started.length === 2 && !awake.holding && awake.problem.includes("caffeinate ended"), awake.problem)
  awake.set(false); awake.set(true)
  check("keep awake: off and on again tries once more", started.length === 3 && awake.holding && awake.problem === "")
  awake.stop()
}

async function realCaffeinate(check: Check) {
  if (process.platform !== "darwin") return
  const { KeepAwake } = await import("../../../plugins/core/mcp/awake.ts")
  const real = new KeepAwake()
  real.set(true)
  const pid = real.child?.pid
  const alive = (p?: number) => { try { return !!p && process.kill(p, 0) } catch { return false } }
  await sleep(200)
  const was = alive(pid)
  real.set(false)
  const t0 = Date.now()
  while (alive(pid) && Date.now() - t0 < 3000) await sleep(20)
  check("keep awake: caffeinate really runs, and really stops", was && !alive(pid) && !real.problem, { pid, was, problem: real.problem })
}

async function setting({ VAULT, api, app, check }: VaultTest) {
  const mcp = app.plugins.find((p: Any) => p.id === "mcp")!
  const seen: Any[] = []
  mcp.onSettings((s: Any) => seen.push(s.keepAwake))
  let [, body] = await api("GET", "mcp/connections")
  const before = body.away
  await api("PATCH", "config/plugin/mcp", { keepAwake: true })
  ;[, body] = await api("GET", "mcp/connections")
  const after = body.away
  const file = path.join(VAULT, ".vaultite", "plugins", "mcp", "data.json")
  check("keep awake: the setting is this machine's, never written in the vault, and heard at once",
    seen.at(-1) === true && !(fs.existsSync(file) && fs.readFileSync(file, "utf8").includes("keepAwake")), { seen, file: fs.existsSync(file) && fs.readFileSync(file, "utf8") })
  const supported = process.platform !== "win32" && after.keepAwake !== null
  check("keep awake: Connections says the machine's word, and the switch where it works (held only while signed in to Vaultite Cloud)",
    after.machine === (process.platform === "darwin" ? "Mac" : "computer") && before.missed === null
    && (supported ? after.keepAwake.on === true && before.keepAwake.on === false && after.keepAwake.holding === false : after.keepAwake === null), { before, after })
  await api("PATCH", "config/plugin/mcp", { keepAwake: null })
  check("keep awake: turned off", seen.at(-1) === undefined)
}

export default async ($: VaultTest) => {
  await notice($.check)
  await frame($.check)
  await holder($.check)
  await realCaffeinate($.check)
  await setting($)
}
