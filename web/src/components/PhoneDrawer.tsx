import { Activity, memo, useEffect, useLayoutEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { ChevronsUpDown } from "lucide-react"
import { APP_PAGES, appPageOf, hrefOf, openAppPage } from "@/core/apppages"
import { onAway } from "@/core/away"
import type { Store } from "@/core/data"
import { fingerHolding } from "@/core/drag"
import { haptic } from "@/core/haptics"
import { route } from "@/core/nav"
import { usePageLock } from "@/core/pagelock"
import { isDesktop, useDesktop } from "@/core/platform"
import { drawerPanels, phoneDock, setDrawerOpener, useSidebars, type Side } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { menuFor } from "@/components/ContextMenu"
import { Drawn, Guard } from "@/components/Guard"
import { panelMenu, SidebarPanels } from "@/components/Sidebar"
import { cn } from "@/lib/utils"
import { share } from "@/core/share"
import { SharedWith } from "@/components/SharedWith"
import { selecting } from "@/core/select"
import { signal } from "@/core/signal"
import { trackSoon } from "@/core/unsaved"
import { closestOf, elementOf } from "@/core/dom"
import { EDGE, edgeTouch, setEdgeTouch } from "@/core/edgetouch"

let out: Side | null = null
const subs = signal()
setDrawerOpener((side) => openDrawer(side))

export function openDrawer(side: Side | null) {
  if (out === side) return
  out = side
  subs.notify()
}
export const drawerOut = () => out
const useDrawer = () => subs.use(() => out)
export function useHasDrawer(side: Side) {
  const { disabled } = usePrefs()
  const s = useSidebars()
  return drawerPanels(side, s, disabled).length > 0 || (side === "left" && phoneDock(s, disabled).length > 0)
}

const EASE = "cubic-bezier(.2,.8,.2,1)"
const SIDES = ["left", "right"] as const
const width = () => Math.min(innerWidth * 0.86, 360)

function edgeOpens(el: Element, side: Side) {
  const page = document.getElementById("main-scroll")
  if (!page || el.closest("[data-phone-header]")) return false
  if (el !== document.body && el !== document.documentElement && !page.contains(el)) return false
  if (el.closest("input:not([type=checkbox], [type=radio]), textarea, select, [contenteditable=true]:focus, [data-term], [data-keeps-touch], [data-own-hold]")) return false
  for (let a: Element | null = el; a && a !== page; a = a.parentElement) {
    const cs = getComputedStyle(a)
    if (cs.touchAction === "none" || cs.touchAction === "pinch-zoom") return false
    if (/auto|scroll/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1) {
      if (side === "left" ? a.scrollLeft > 0 : a.scrollLeft + a.clientWidth < a.scrollWidth - 1) return false
    }
  }
  return true
}

type BodyProps = { store: Store; file: string; tab: string; vaultName: string; vaultMenu: (e: React.MouseEvent) => void }
type Drag = { side: Side; x: number; y: number; axis: "x" | "y" | null; from: number; p: number; t: number; v: number; quit?: () => void }

/** Both drawers, drawn ahead while the phone idles and kept hidden while shut (Activity), so opening one only slides it. */
export function PhoneDrawers(props: BodyProps) {
  const side = useDrawer()
  const phone = !useDesktop()
  usePageLock(!!side)
  useEffect(() => { if (side) document.documentElement.dataset.drawer = side; else delete document.documentElement.dataset.drawer }, [side])
  const has = { left: useHasDrawer("left"), right: useHasDrawer("right") }
  const [drawn, setDrawn] = useState<Side | null>(null)
  const boxes = { left: useRef<HTMLDivElement>(null), right: useRef<HTMLDivElement>(null) }, shade = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const pos = useRef(0)

  const place = (s: Side, p: number, ms = 0) => {
    pos.current = p
    const el = boxes[s].current, bg = shade.current
    if (!el || !bg) return
    const t = ms ? `${ms}ms ${EASE}` : ""
    // Put there at once: a running slide would carry on from where it was.
    if (!ms) for (const a of [...el.getAnimations(), ...bg.getAnimations()]) a.cancel()
    el.style.transition = t && `transform ${t}`
    el.style.transform = `translateX(${(s === "left" ? -1 : 1) * (1 - p) * 100}%)`
    bg.style.transition = t && `opacity ${t}`
    bg.style.opacity = String(p)
    bg.style.pointerEvents = p > 0 ? "auto" : "none"
  }
  const putAway = (s: Side) => { if (!out && !drag.current) { place(s, 0); setDrawn(null) } }

  useEffect(() => {
    if (side) { setDrawn(side); requestAnimationFrame(() => place(side, 1, 280)); return }
    if (!drawn) return
    place(drawn, 0, 240)
    let due = true
    const t = setTimeout(() => { due = false; putAway(drawn) }, 260), off = trackSoon("the drawer closing", () => due)
    return () => { clearTimeout(t); off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when a drawer opens or closes
  }, [side])
  useEffect(closesOnLeaving, [])

  const start = (e: React.PointerEvent | PointerEvent, s: Side, from: number) => {
    if (e.pointerType === "mouse" && e.button) return
    drag.current?.quit?.()
    drag.current = { side: s, x: e.clientX, y: e.clientY, axis: null, from, p: from, t: e.timeStamp, v: 0 }
  }
  const move = (e: React.PointerEvent | PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (fingerHolding()) { drag.current = null; return }
    const mx = e.clientX - d.x, my = e.clientY - d.y
    if (!d.axis) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
        d.axis = "x"
        try { (e.currentTarget instanceof Element ? e.currentTarget : elementOf(e.target))?.setPointerCapture(e.pointerId) } catch {}
        d.quit = onAway(end)
        if (drawn !== d.side) flushSync(() => setDrawn(d.side))
      } else if (Math.abs(my) > 8) { d.axis = "y"; drag.current = null; return }
    }
    if (d.axis !== "x") return
    const p = Math.max(0, Math.min(1, d.from + ((d.side === "left" ? 1 : -1) * mx) / width()))
    const dt = Math.max(1, e.timeStamp - d.t)
    d.v = (p - d.p) / dt
    d.p = p; d.t = e.timeStamp
    place(d.side, p)
  }
  const end = () => {
    const d = drag.current
    drag.current = null
    setEdgeTouch(false)
    d?.quit?.()
    if (!d || d.axis !== "x") return
    const open = Math.abs(d.v) > 0.0015 ? d.v > 0 : d.from ? d.p > 0.66 : d.p > 0.33
    if (open !== (out === d.side)) haptic("soft")
    if (open && out === d.side) place(d.side, 1, 220)
    else if (!open && !out) { place(d.side, 0, 220); setTimeout(() => putAway(d.side), 240) }
    else openDrawer(open ? d.side : null)
  }
  const handlers = { onPointerMove: move, onPointerUpCapture: end, onPointerCancelCapture: end }
  useEdgeSwipes({ has, side, start, move, end })

  return (
    <>
      <div ref={shade} aria-hidden onPointerDown={(e) => drawn && start(e, drawn, 1)} {...handlers}
        onClick={() => { if (pos.current === 1) openDrawer(null) }}
        className="fixed inset-0 z-40 bg-black/40 md:hidden" style={{ opacity: 0, pointerEvents: "none", touchAction: "pan-y" }} />
      {SIDES.map((s) => has[s] && (
        <div key={s} ref={boxes[s]} data-phone-drawer={drawn === s ? s : undefined} role="dialog" aria-label={s === "right" ? "Right sidebar" : "Sidebar"} aria-hidden={side !== s}
          onPointerDown={(e) => start(e, s, 1)} {...handlers}
          onClick={(e) => {
            if (e.defaultPrevented || selecting()) return
            if (closestOf(e.target, "[data-tree-path]:not([data-tree-folder]), a[href^='#']") && !closestOf(e.target, "[aria-haspopup], [data-no-drag]")) setTimeout(() => openDrawer(null))
          }}
          className={cn("fixed inset-y-0 z-40 flex flex-col bg-sidebar shadow-xl md:hidden", s === "right" ? "right-0 pr-[env(safe-area-inset-right)]" : "left-0 pl-[env(safe-area-inset-left)]", drawn !== s && "invisible")}
          style={{ width: "min(86vw, 360px)", transform: `translateX(${s === "right" ? 100 : -100}%)`, touchAction: "pan-y" }}>
          {(phone || drawn === s) && (
            <Activity mode={drawn === s ? "visible" : "hidden"}><DrawerBody side={s} asleep={drawn !== s} {...props} /></Activity>
          )}
        </div>
      ))}
    </>
  )
}

function closesOnLeaving() {
  let was = route().tab
  const on = () => {
    const now = route().tab
    if (now === was) return
    was = now
    const typing = document.activeElement?.closest("[data-phone-drawer]") && document.activeElement.matches("input, textarea, [contenteditable]")
    if (out && !typing) openDrawer(null)
  }
  addEventListener("hashchange", on)
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && out) openDrawer(null) }
  addEventListener("keydown", esc)
  return () => { removeEventListener("hashchange", on); removeEventListener("keydown", esc) }
}

type Gesture = { has: Record<Side, boolean>; side: Side | null; start: (e: PointerEvent, s: Side, from: number) => void; move: (e: PointerEvent) => void; end: () => void }

function useEdgeSwipes(now: Gesture) {
  const live = useRef(now)
  useLayoutEffect(() => { live.current = now })
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const { has, side, start } = live.current
      if (e.pointerType !== "touch" || !e.isPrimary || side || isDesktop()) return
      const s: Side | null = e.clientX < EDGE ? "left" : e.clientX > innerWidth - EDGE ? "right" : null
      const el = elementOf(e.target)
      if (!s || !has[s] || !el || !edgeOpens(el, s)) return
      setEdgeTouch(true)
      start(e, s, 0)
    }
    const move = (e: PointerEvent) => { if (edgeTouch()) live.current.move(e) }
    const up = () => { if (edgeTouch()) live.current.end() }
    const opts = { capture: true, passive: true }
    addEventListener("pointerdown", down, opts)
    addEventListener("pointermove", move, opts)
    addEventListener("pointerup", up, opts)
    addEventListener("pointercancel", up, opts)
    return () => {
      removeEventListener("pointerdown", down, opts)
      removeEventListener("pointermove", move, opts)
      removeEventListener("pointerup", up, opts)
      removeEventListener("pointercancel", up, opts)
    }
  }, [])
}

const DrawerBody = memo(function DrawerBody({ side, store, file, tab, vaultName, vaultMenu }: BodyProps & { side: Side; asleep: boolean }) {
  const { tab: on } = route()
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col px-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <div data-size-up className="flex min-h-0 flex-1 flex-col">
          <SidebarPanels side={side} store={store} open phone file={file} tab={tab} />
        </div>
      </div>
      {side === "left" && (
        <div className="shrink-0 border-t-[0.5px] border-border pt-1.5">
        <Dock store={store} file={file} tab={tab} />
        <nav aria-label="App" className="flex items-center gap-1 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          {share ? <SharedWith phone /> : (
          <button type="button" onClick={vaultMenu} aria-haspopup="menu"
            className="-ml-1.5 flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[10px] px-1.5 text-left active:bg-foreground/[0.06]">
            <span className="min-w-0 truncate text-[15px] font-semibold">{vaultName}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-tertiary" strokeWidth={2} />
          </button>)}
          {APP_PAGES.map((p) => (
            <a key={p.id} href={hrefOf(p)} aria-label={p.label} aria-current={appPageOf(on) === p ? "page" : undefined} data-app-page={p.id}
              onClick={(e) => { e.preventDefault(); openAppPage(p) }}
              className={cn("grid size-11 shrink-0 place-items-center rounded-[10px] active:bg-foreground/[0.06]", appPageOf(on) === p ? "text-primary" : "text-muted-foreground")}>
              <p.icon className="size-[21px]" strokeWidth={2} />
            </a>
          ))}
        </nav>
        </div>
      )}
    </>
  )
}, (_was, now) => now.asleep)

function Dock({ store, file, tab }: { store: Store; file: string; tab: string }) {
  const { disabled } = usePrefs()
  const docked = phoneDock(useSidebars(), disabled)
  if (!docked.length) return null
  return (
    <div aria-label="Dock" role="toolbar" data-phone-dock className="flex flex-col px-0.5">
      {docked.map(({ key, panel }) => (
        <div key={key} data-panel={key} data-ui={`panel:${key}`} onContextMenu={menuFor(() => panelMenu(key))}>
          <Guard what={`The ${panel.title} panel`}><Drawn draw={() => panel.render({ store, open: false, phone: true, dock: true, file, tab, panel: key })} /></Guard>
        </div>
      ))}
    </div>
  )
}
