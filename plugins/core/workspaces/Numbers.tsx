import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown } from "lucide-react"
import { Mark } from "./Mark"
import { preloadList } from "./chunks"
import { List } from "./later"
import { cn, colorVar, commandKeys, getStore, menuFor, onTabLayoutChange, panesClosed, pluginOn, sidebarsChanged, WORKSPACES, startDrag, tabsInWorkspace, useDismiss, useDrag, useDropHit, useDropTarget, trackSoon, type DragItem, type SidebarCtx, type Store } from "@vaultite"
import {
  ALL_TABS, cycle, emit, getRenaming, moveAt, label, leaving, lit as litNow, lookOf, named, othersOnly, renamed, saveTabs, saveTabsSoon, savePending, sendTo, slotMenu, slots,
  sync, tookTabs, used, useVersion, type Sent,
} from "./state"

function Switcher({ lit, over, rail }: { lit: number; over: number | null; rail: boolean }) {
  const [shown, setOpen] = useState(false)
  const open = shown || !!getRenaming()
  const shut = () => {
    const m = getRenaming()
    if (m) renamed(m, box.current?.querySelector("input")?.value ?? null)
    setOpen(false)
  }
  const btn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: 0, top: 0 })
  const [sprung, setSprung] = useState(false)
  const dragging = useDrag((d) => !!d)
  const overButton = useDrag((d) => {
    const r = d && sent(d.item) ? btn.current?.getBoundingClientRect() : null
    return !!d && !!r && d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom
  })
  useEffect(() => {
    if (!dragging) { if (sprung) { setSprung(false); setOpen(false) } return }
    if (!open && overButton) { setSprung(true); setOpen(true) }
  }, [dragging, overButton, open, sprung])
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect(), w = box.current?.offsetWidth ?? 208
    setAt(rail ? { left: r.right + 8, top: r.top - 4 } : { left: Math.max(8, Math.min(r.left, innerWidth - 8 - w)), top: r.bottom + 4 })
  }, [open, rail])
  useEffect(() => { const t = setTimeout(() => void preloadList(), 1500); return () => clearTimeout(t) }, [])
  useDismiss(open, shut, { inside: "[data-workspace-list], [role=menu], [aria-label='Close menu']", anchor: btn, escape: (e) => !(e.target instanceof Element && e.target.closest("input")) })
  const arrows = (e: React.KeyboardEvent) => {
    if (e.target instanceof Element && e.target.closest("input")) return
    const rows = [...(box.current?.querySelectorAll<HTMLElement>("[data-workspace]") ?? [])]
    const i = document.activeElement instanceof HTMLElement ? rows.indexOf(document.activeElement) : -1
    const to = e.key === "ArrowDown" ? (i + 1) % rows.length : e.key === "ArrowUp" ? (i - 1 + rows.length) % rows.length
      : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    rows[to]?.focus()
  }
  const n = lit || 1
  return (
    <>
      <button ref={btn} type="button" data-workspace-switcher={n} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${label(n)}: switch workspace`} data-tip={open ? undefined : `${label(n)}${commandKeys("workspace:1") ? ` (${commandKeys("workspace:1")} to ${commandKeys(`workspace:${WORKSPACES}`)})` : ""}`} data-tip-side={rail ? "right" : undefined}
        onClick={() => (open ? shut() : setOpen(true))} onPointerEnter={() => void preloadList()} onContextMenu={menuFor(() => slotMenu(n))}
        onPointerDown={(e) => startDrag(e, { from: "workspace", to: `view:${ALL_TABS}`, label: "Workspaces" })}
        className={cn("flex shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-[5px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
          rail ? "size-7" : "h-6 pr-0.5 pl-1", open && "bg-foreground/[0.08] text-foreground")}>
        <Mark n={n} {...lookOf(n)} look="border-[1.5px] border-current font-semibold" />
        {!rail && <ChevronDown className="size-3 text-tertiary" strokeWidth={2.25} />}
      </button>
      {open && createPortal(
        <div ref={box} role="dialog" aria-label="Workspaces" data-workspace-list onKeyDown={arrows}
          className="glass-strong fixed z-40 flex w-52 flex-col gap-px rounded-[10px] p-1 shadow-xl"
          style={at}>
          <List lit={lit} over={over} focus={!sprung} close={shut} />
        </div>,
        document.body,
      )}
    </>
  )
}

export function Background({ store }: { store: Store }) {
  const w = store.workspaces
  useVersion()
  const tint = lookOf(litNow()).tint
  useEffect(() => {
    const root = document.documentElement
    if (tint) root.style.setProperty("--space-tint", colorVar(tint)); else root.style.removeProperty("--space-tint")
    return () => { root.style.removeProperty("--space-tint") }
  }, [tint])
  useSwipes()
  useEffect(() => {
    const own = tabsInWorkspace(true)
    if (own) tookTabs(own)
    const off = onTabLayoutChange(saveTabsSoon), unsaved = trackSoon("tabs", savePending, true)
    addEventListener("pagehide", leaving)
    return () => {
      off(); unsaved(); removeEventListener("pagehide", leaving)
      if (savePending()) saveTabs()
      if (!pluginOn("workspaces")) panesClosed(othersOnly())
    }
  }, [])
  useEffect(() => { sync(); emit(); sidebarsChanged() }, [w])
  return null
}

function useSwipes() {
  useEffect(() => {
    let sum = 0, done = false, quiet = 0
    const untrack = trackSoon("a swipe's end", () => quiet !== 0)
    const sideways = (from: Element, side: Element) => {
      for (let e: Element | null = from; e && e !== side; e = e.parentElement) {
        if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)) return true
      }
      return false
    }
    const wheel = (e: WheelEvent) => {
      const el = e.target instanceof Element ? e.target : null, side = el?.closest("aside[data-side]")
      if (!el || !side || e.ctrlKey) return
      clearTimeout(quiet)
      quiet = window.setTimeout(() => { sum = 0; done = false; quiet = 0 }, 250)
      if (done || Math.abs(e.deltaX) <= Math.abs(e.deltaY) || used().length < 2 || sideways(el, side)) return
      sum += e.deltaX
      if (Math.abs(sum) < 80) return
      done = true
      cycle(sum > 0 ? 1 : -1)
    }
    addEventListener("wheel", wheel, { passive: true })
    return () => { untrack(); removeEventListener("wheel", wheel); clearTimeout(quiet) }
  }, [])
}

const sent = (item: DragItem): Sent | null => {
  const a = item.away
  if (a) return a.group ? { group: a.group } : a.tab ? { tab: a.tab } : null
  return item.group ? { group: item.group } : sentOne(item)
}
function sentOne(item: DragItem): Sent | null {
  if (item.pane) return { pane: item.pane }
  if (item.tab) return item.to && item.to !== "new" ? { tab: item.tab } : null
  if (item.paths && (item.from === "tree" || item.from === "pin")) {
    const s = getStore(), files = new Set([...(s?.files.files ?? []), ...(s?.files.others ?? [])].map((f) => f.path))
    const open = item.from === "pin" ? item.paths : item.paths.filter((p) => files.has(p))
    return open.length ? { open } : null
  }
  if (item.path && !item.folder && (item.from === "tree" || item.from === "pin")) return { open: [item.path] }
  return null
}

function useSendDrop() {
  const id = `workspaces:${useId()}`
  useDropTarget<{ n: number; what: Sent }>(id, (item, _x, _y, el) => {
    const n = Number(el?.closest<HTMLElement>("[data-workspace]")?.dataset.workspace)
    const what = sent(item), from = item.away?.workspace ?? litNow()
    if (!what || !n || n === from) return null
    return { n, what }
  }, (item, h) => void (item.away && !("open" in h.what) ? moveAt(item.away.workspace, h.n, h.what, {}) : sendTo(h.n, h.what)), {
    hint: ({ n, what }) => ("open" in what ? `Open in ${named(n)}` : "pane" in what ? `Move pane to ${named(n)}` : "group" in what ? `Move group to ${named(n)}` : `Move to ${named(n)}`),
    into: () => true,
  })
  return useDropHit<{ n: number }>(id)?.n ?? null
}

export function Workspaces({ open, phone }: SidebarCtx) {
  useVersion()
  const over = useSendDrop()
  const list = slots()
  if (!list) return null
  const lit = litNow()
  if (phone) return null
  return <Switcher lit={lit} over={over} rail={!open} />
}

