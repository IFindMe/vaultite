// Passkeys in a page's frames (electron/browser/passkeys.ts, passkeys-preload.cjs), answered before any phone; WRITES
// only the throwaway vault. Usage: node web/qa/passkeyframes.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, keepAwake, uiAt } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-passkeyframes-"))
keepAwake(300)

const ASK = `<script>
  const frame = String(window.name)
  const shim = !/native code/.test(String(CredentialsContainer.prototype.get))
  navigator.credentials.get({ publicKey: { challenge: new Uint8Array(4) } })
    .then(() => "resolved", (e) => e.name + ": " + e.message)
    .then((answer) => parent.postMessage({ frame, shim, answer }, "*"))
</script>`
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://localhost")
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  if (u.pathname === "/ask") return res.end(`<!doctype html><title>Sign in</title>${ASK}`)
  const port = server.address().port
  res.end(`<!doctype html><title>Bank</title><script>
    const answers = {}
    addEventListener("message", (e) => { answers[e.data.frame] = e.data; document.documentElement.dataset.answers = JSON.stringify(answers) })
  </script>
  <iframe name="same" src="/ask"></iframe>
  <iframe name="other" src="http://login.localhost:${port}/ask"></iframe>
  <iframe name="allowed" allow="publickey-credentials-get" src="http://login.localhost:${port}/ask"></iframe>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, ok) })
const SITE = `http://localhost:${server.address().port}/`

const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
const plugins = fs.existsSync(pluginsFile) ? JSON.parse(fs.readFileSync(pluginsFile, "utf8")) : {}
fs.mkdirSync(path.dirname(pluginsFile), { recursive: true })
fs.writeFileSync(pluginsFile, JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []).filter((x) => x !== "web-viewer"), "web-viewer"],
  disabled: (plugins.disabled ?? []).filter((x) => x !== "web-viewer") }, null, 2) + "\n")

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin

const answers = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  return v?.webContents.executeJavaScript(`document.documentElement.dataset.answers || "{}"`).then((s) => JSON.parse(s)) ?? {}
})
await uiAt(origin)({ action: "open", path: `view:web/${SITE}` })
const all = async () => { const a = await answers(); return a.same && a.other && a.allowed ? a : null }
const got = (await until(all, 30000)) ? await all() : await answers()
const reached = (a) => a?.shim && /challenge is too short/.test(a.answer)
check("a frame of the page's own site: its passkey request reaches the app", reached(got?.same), got?.same)
check("a frame of another site the page allows: reaches the app too", reached(got?.allowed), got?.allowed)
check("a frame of another site not allowed: refused, as Chromium does", /^NotAllowedError: .*publickey-credentials-get/.test(got?.other?.answer ?? ""), got?.other)

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
