// Phones' edges and held fingers: components/PhoneDrawer.tsx, core/edgetouch.ts, components/ContextMenu.tsx, core/nav.ts,
// components/PhoneBar.tsx, plugins/core/editing/menu.ts. WRITES Qa holds/: node web/qa/phoneholds.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { app } from "./lib/app.mjs"
import { apiAt, fingers, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/phoneholds-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
await api("POST", "file", { path: "Qa holds/Harbour.md", text: "# Harbour\n\n- [ ] Check the tide table\n\nSee [[Lighthouse walk]] for the path.\n" })
await api("POST", "file", { path: "Qa holds/Lighthouse walk.md", text: "# Lighthouse walk\n\nAlice Park walks it at dawn. Ask [[Keeper]].\n" })
await api("POST", "file", { path: "Qa holds/Keeper.md", text: "# Keeper\n\nBob Lee keeps the light.\n" })

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ }), ui = app(page)
const { touch, swipe } = await fingers(page)
const at = (sel, text) => page.evaluate(([sel, text]) => {
  const e = [...document.querySelectorAll(sel)].find((x) => (!text || x.textContent.trim() === text) && !x.closest("[data-kept]") && x.getClientRects().length)
  if (!e) return null
  e.scrollIntoView({ block: "center" })
  const r = e.getBoundingClientRect()
  return { x: r.x + Math.min(r.width / 2, 30), y: r.y + r.height / 2, left: r.x }
}, [sel, text])
// oxlint-disable-next-line vaultite/no-sleep -- a tap is a finger down this long
const tap = async (p) => { await touch("touchStart", p.x, p.y); await wait(50); await touch("touchEnd"); await ui.idle() }
// oxlint-disable-next-line vaultite/no-sleep -- a hold is a finger kept down this long
const hold = async (p) => { await touch("touchStart", p.x, p.y); await wait(700); await touch("touchEnd"); await ui.idle() }
const menu = () => page.evaluate(() => {
  const m = [...document.querySelectorAll("[role=menu]")].pop()
  return m ? [...m.querySelectorAll("[role^=menuitem]")].map((b) => b.textContent.trim()) : null
})
const shut = async () => { await page.keyboard.press("Escape"); await until(async () => !(await menu()), 3000) }
const title = () => page.evaluate(() => document.querySelector("[data-phone-header]")?.textContent.trim() ?? "")
const drawer = () => page.evaluate(() => document.querySelector("[data-phone-drawer]")?.getAttribute("aria-hidden") === "false")

await page.goto(`${B}#file/${encodeURIComponent("Qa holds/Harbour.md")}`)
await page.waitForSelector(".cm-task"); await ui.idle()

const box = await at(".cm-task")
const was = await page.evaluate(() => document.querySelector(".cm-task")?.checked)
await tap({ x: Math.max(4, box.left - 4), y: box.y })
check("a tap at the screen's edge reaches the checkbox there", await until(() => page.evaluate((was) => document.querySelector(".cm-task")?.checked === !was, was), 3000))
check("…and opens no sidebar", !(await drawer()))
await swipe(4, 420, 280, 424); await ui.idle()
check("a sideways drag from the edge still opens the sidebar", await until(drawer, 3000))
await page.screenshot({ path: `${OUT}edge-drawer.png` })
await page.keyboard.press("Escape"); await until(async () => !(await drawer()), 3000)

const link = await at(".cm-wikilink", "Lighthouse walk")
await hold(link)
const lm = await menu()
check("a held link shows the link's menu", !!lm?.includes("Open in new tab") && !!lm?.includes("Copy link"), lm)
check("…not the editor's", !!lm && !lm.some((l) => /^(Select all|Paste|Format)/.test(l)), lm)
await page.screenshot({ path: `${OUT}link-menu.png` })
await shut()
check("…and the link isn't followed", /Harbour/.test(await title()), await title())

await tap(await at(".cm-wikilink", "Lighthouse walk")); await until(async () => /Lighthouse walk/.test(await title()), 3000)
await tap(await at(".cm-wikilink", "Keeper")); await until(async () => /Keeper/.test(await title()), 3000)
await hold(await at("[data-bar=back]"))
check("held Back lists the pages behind, nearest first", JSON.stringify(await menu()) === JSON.stringify(["Lighthouse walk", "Harbour"]), await menu())
check("…and doesn't go back", /Keeper/.test(await title()), await title())
await page.screenshot({ path: `${OUT}back-menu.png` })
await tap(await at("[role=menu] [role^=menuitem]", "Harbour"))
check("picking a page goes back that far", await until(async () => /Harbour/.test(await title()), 3000), await title())
await hold(await at("[data-bar=forward]"))
check("held Forward lists the pages ahead", JSON.stringify(await menu()) === JSON.stringify(["Lighthouse walk", "Keeper"]), await menu())
await shut()

await hold(await at("[data-tabs-button]"))
const tm = await menu()
check("the held tabs button offers New tab and closing tabs", JSON.stringify(tm) === JSON.stringify(["New tab", "Close tab", "Close other tabs", "Close all tabs"]), tm)
await shut()
await done()
