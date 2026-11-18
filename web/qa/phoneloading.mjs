// A note opened on a slow or lost connection, at iPhone size. WRITES Qa loading/: throwaway server only.

//   node web/qa/phoneloading.mjs <base url> [out dir]
// Paths: components/FileView.tsx, components/Pending.tsx, core/reading.ts, core/connection.ts, core/live.ts, core/http.ts
import { mkdirSync } from "node:fs"
import { apiAt, qa } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = "/tmp/phoneloading-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const run = Date.now().toString(36)
const note = (name) => `Qa loading/${name} ${run}.md`
const SLOW = note("Slow"), OFF = note("Offline"), HUB = note("Hub")
const body = "The keeper's log for the Lighthouse, kept by Alice Park."
for (const p of [SLOW, OFF]) await api("POST", "file", { path: p, text: `# ${p.split("/")[1].slice(0, -3)}\n\n${body}\n` })
await api("POST", "file", { path: HUB, text: `# Hub\n\n- [[${SLOW.slice(0, -3)}|Slow one]]\n- [[${OFF.slice(0, -3)}|Offline one]]\n` })

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => {
  const WS = window.WebSocket
  window.__qaSockets = []
  window.WebSocket = class extends WS { constructor(...a) { super(...a); window.__qaSockets.push(this) } }
})
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket|ERR_INTERNET_DISCONNECTED/ })
const { idle, toast } = app(page)
const shot = (n) => page.screenshot({ path: `${OUT}phoneloading-${n}.png` })
const shown = (p) => page.locator(`article.file-view[data-path="${p}"]:not([data-opening])`).filter({ hasText: body })
async function hub() {
  await page.goto("about:blank")
  await page.goto(`${B}#file/${encodeURIComponent(HUB)}`)
  await page.getByText("Slow one", { exact: true }).first().waitFor({ timeout: 20_000 })
  await idle()
}

await hub()
let release
const held = new Promise((r) => { release = r })
await page.route((u) => u.pathname.endsWith("/api/file") && u.searchParams.get("path") === SLOW, async (route) => { await held; await route.continue().catch(() => {}) })
await page.getByText("Slow one", { exact: true }).first().tap()
const skeleton = page.locator(`article[data-opening][data-path="${SLOW}"] .skeleton`).first()
check("a slow read shows the note's skeleton, not a blank", await skeleton.waitFor({ timeout: 5000 }).then(() => true, () => false))
const slowLine = page.locator("[data-read-slow]")
check("then says it's still loading, with Try again", await slowLine.filter({ hasText: "Still loading" }).getByRole("button", { name: "Try again" })
  .waitFor({ timeout: 10_000 }).then(() => true, () => false))
await shot("slow")
release()
check("the note shows once the read comes", await shown(SLOW).waitFor({ timeout: 15_000 }).then(() => true, () => false))
await page.unroute(() => true)

await hub()
await ctx.setOffline(true)
await page.evaluate(() => { for (const s of window.__qaSockets) s.close() })
await page.getByText("Offline one", { exact: true }).first().tap()
const failed = page.locator(`[data-read-failed]`)
await failed.waitFor({ timeout: 10_000 }).catch(() => {})
const said = await failed.innerText().catch(() => "")
check("offline, a note says it couldn't open and why", /Couldn't open this note: the server didn't answer/.test(said), said)
check("not that it isn't in the vault", !(await page.getByText("isn't in the vault any more").count()))
await shot("offline-open")
const told = await toast.wait(/Can't connect to Vaultite|You're offline/, { timeout: 20_000 }).then(() => true, () => false)
check("after a grace, the app says it can't connect, with Try now", told && await page.locator("[data-sonner-toast]").getByRole("button", { name: "Try now" }).count() > 0)
await shot("offline-toast")

await ctx.setOffline(false)
check("back online, Reconnected takes its place", await toast.wait("Reconnected", { timeout: 40_000 }).then(() => true, () => false)
  && !(await page.locator("[data-sonner-toast]").filter({ hasText: /Can't connect|You're offline/ }).count()))
check("and the note opens by itself", await shown(OFF).waitFor({ timeout: 15_000 }).then(() => true, () => false))
await shot("reconnected")

await done()
