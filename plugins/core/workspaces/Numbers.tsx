import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, LayoutGrid } from "lucide-react"
import { Mark as Look } from "./Mark"
import { tintWash } from "./tint"
import { cn, colorVar, commandKeys, getStore, menuFor, onTabLayoutChange, panesClosed, pluginOn, reorder as reorderKeys, sidebarsChanged, slotAt, startDrag, tabsInWorkspace, useDismiss, useDrag, useDropHit, useDropTarget, useSlide, trackSoon, type DragItem, type SidebarCtx, type Store } from "@vaultite"
import {
  cycle, emit, getRenaming, moveAt, label, leaving, lit as litNow, lookOf, markOf, named, othersOnly, patch, reorder, showAllTabs, saveTabs, saveTabsSoon, savePending, sendTo, setRenaming, slotMenu, slots,
  SLOTS, switchTo, sync, tookTabs, used, useVersion, type Sent,
} from "./state"
import { moved } from "./order"

function Mark({ n, look, size }: { n: number; look: string; size?: string }) {
  return <Look n={n} {...lookOf(n)} look={look} size={size} />
}

function Rename({ n, on, end }: { n: number; on: boolean; end: (enter: boolean) => void }) {
  const done = (name: string | null) => renamed(n, name)
  return (
    <div data-workspace={n} data-slide={n} style={tintWash(lookOf(n).tint, on)} className={cn("flex h-7 items-center gap-2 rounded-[5px] px-1.5", on && "bg-foreground/[0.08]")}>
      <Mark n={n} look={cn("border", on ? "border-primary/60 bg-primary/10 font-semibold text-primary" : "border-border font-medium text-foreground")} />
      <input autoFocus onFocus={(e) => e.currentTarget.select()} aria-label={`Name of workspace ${n}`}
        defaultValue={slots()?.[n - 1]?.name ?? ""} placeholder={`Workspace ${n}`}
        onKeyDown={(e) => {
          if (e.key === "Enter") { done(e.currentTarget.value); end(true) }
          else if (e.key === "Escape") { done(null); end(false) }
        }}
        onBlur={(e) => done(e.currentTarget.value)}
        className="-mx-1 h-[22px] min-w-0 flex-1 rounded-[4px] border-[0.5px] border-primary bg-background px-1 text-[13px] outline-none" />
    </div>
  )
}

function renamed(n: number, name: string | null) {
  if (getRenaming() !== n) return
  setRenaming(0)
  if (name !== null) patch(n, { name: name.trim() || null })
}

type Order = { from: number; to: number; order: string[] }
const ORDER = "workspaces:order"
let droppedAt = 0
function useOrderDrop(rows: React.RefObject<HTMLDivElement | null>, done: (o: Order) => void) {
  useDropTarget<Order>(ORDER, (item, x, y) => {
    const el = rows.current
    if (!item.workspace || !el) return null
    const b = el.getBoundingClientRect()
    if (x < b.left - 40 || x > b.right + 40 || y < b.top - 28 || y > b.bottom + 28) return null
    const list = [...el.querySelectorAll<HTMLElement>(":scope > [data-slide]")]
    const { order, same } = reorderKeys(list.map((e) => e.dataset.slide!), [String(item.workspace)], slotAt(el, list, x, y, "y"))
    return same ? null : { from: item.workspace, to: order.indexOf(String(item.workspace)) + 1, order }
  }, (_item, h) => { droppedAt = Date.now(); done(h) }, { hint: (h) => `Make it ${h.to}` })
  return useDropHit<Order>(ORDER)?.order ?? null
}

function Switcher({ lit, over, rail }: { lit: number; over: number | null; rail: boolean }) {
  const list = slots()!
  const [shown, setOpen] = useState(false)
  const renaming = getRenaming()
  const open = shown || !!renaming
  const shut = () => {
    const m = getRenaming()
    if (m) renamed(m, box.current?.querySelector("input")?.value ?? null)
    setOpen(false)
  }
  const btn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const rows = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<Order | null>(null)
  useSlide(rows, useOrderDrop(rows, (o) => { setPending(o); void reorder(o.from, o.to)?.finally(() => setPending(null)) }), "y")
  const shownOrder = pending ? moved(SLOTS, pending.from, pending.to) : SLOTS
  const [at, setAt] = useState({ left: 0, top: 0 })
  const sprung = useRef(false)
  const dragging = useDrag((d) => !!d)
  const overButton = useDrag((d) => {
    const r = d && sent(d.item) ? btn.current?.getBoundingClientRect() : null
    return !!d && !!r && d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom
  })
  useEffect(() => {
    if (!dragging) { if (sprung.current) { sprung.current = false; setOpen(false) } return }
    if (!open && overButton) { sprung.current = true; setOpen(true) }
  }, [dragging, overButton, open])
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect(), w = box.current?.offsetWidth ?? 208
    setAt(rail ? { left: r.right + 8, top: r.top - 4 } : { left: Math.max(8, Math.min(r.left, innerWidth - 8 - w)), top: r.bottom + 4 })
  }, [open, rail])
  useDismiss(open, shut, { inside: "[data-workspace-list], [role=menu], [aria-label='Close menu']", anchor: btn, escape: (e) => !(e.target instanceof Element && e.target.closest("input")) })
  useEffect(() => {
    if (open && !sprung.current && !getRenaming()) box.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus({ preventScroll: true })
  }, [open])
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
  const ended = (m: number, enter: boolean) => {
    if (enter) shut()
    else requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`button[data-workspace="${m}"]`)?.focus({ preventScroll: true }))
  }
  const n = lit || 1
  return (
    <>
      <button ref={btn} type="button" data-workspace-switcher={n} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${label(n)}: switch workspace`} data-tip={open ? undefined : `${label(n)}${commandKeys("workspace:1") ? ` (${commandKeys("workspace:1")} to ${commandKeys("workspace:5")})` : ""}`} data-tip-side={rail ? "right" : undefined}
        onClick={() => (open ? shut() : setOpen(true))} onContextMenu={menuFor(() => slotMenu(n))}
        className={cn("flex shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-[5px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
          rail ? "size-7" : "h-6 pr-0.5 pl-1", open && "bg-foreground/[0.08] text-foreground")}>
        <Mark n={n} look="border-[1.5px] border-current font-semibold" />
        {!rail && <ChevronDown className="size-3 text-tertiary" strokeWidth={2.25} />}
      </button>
      {open && createPortal(
        <div ref={box} role="dialog" aria-label="Workspaces" data-workspace-list onKeyDown={arrows}
          className="glass-strong fixed z-40 flex w-52 flex-col gap-px rounded-[10px] p-1 shadow-xl"
          style={at}>
          <button type="button" data-workspace-all onClick={() => { setOpen(false); showAllTabs() }}
            className="flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-1.5 text-left text-[13px] outline-none hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07]">
            <LayoutGrid aria-hidden className="size-[18px] shrink-0 p-px text-muted-foreground" strokeWidth={2} />
            <span className="min-w-0 flex-1 truncate">All tabs</span>
            <span className="text-[11px] text-tertiary">{commandKeys("workspace:all-tabs")}</span>
          </button>
          <div className="mx-1 my-1 h-px bg-border" />
          <div className="px-2 pt-0.5 pb-1.5 text-[11px] font-medium text-tertiary">Workspaces</div>
          <div ref={rows} className="relative flex flex-col gap-px">
          {shownOrder.map((m) => renaming === m
            ? <Rename key={m} n={m} on={m === lit} end={(enter) => ended(m, enter)} />
            : <Row key={m} m={m} on={m === lit} has={!!list[m - 1] || m === lit} over={over === m} pick={() => { setOpen(false); switchTo(m) }} />)}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function Row({ m, on, has, over, pick }: { m: number; on: boolean; has: boolean; over: boolean; pick: () => void }) {
  const { tint } = lookOf(m)
  return (
    <button type="button" data-workspace={m} data-slide={m} data-used={has || undefined} data-drop={over || undefined} aria-pressed={on}
      data-tip={has ? label(m) : undefined} data-tip-trunc data-tip-side="right"
      data-tint={tint} style={over ? undefined : tintWash(tint, on)}
      onPointerDown={has ? (e) => startDrag(e, { from: "workspace", workspace: m, label: label(m) }) : undefined}
      onClick={() => { if (Date.now() - droppedAt >= 400) pick() }}
      onContextMenu={menuFor(() => slotMenu(m))}
      className={cn("flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-1.5 text-left text-[13px] transition-colors",
        "outline-none focus-visible:bg-foreground/[0.07]", over ? "bg-primary/15 ring-1 ring-primary/50" : "hover:bg-foreground/[0.07]")}>
      <Mark n={m} look={cn("border", on ? "border-primary/60 bg-primary/10 font-semibold text-primary"
        : has ? "border-border font-medium text-foreground" : "border-dashed border-border text-tertiary")} />
      <span className={cn("min-w-0 flex-1 truncate", on ? "font-medium" : has ? "" : "text-tertiary")}>{has ? label(m) : "New workspace"}</span>
      <Marked n={m} />
      {on && <Check aria-hidden className="size-3.5 shrink-0 text-primary" strokeWidth={2.5} style={tint ? { color: colorVar(tint) } : undefined} />}
      <span className="text-[11px] text-tertiary">{commandKeys(`workspace:${m}`)}</span>
    </button>
  )
}

function Marked({ n }: { n: number }) {
  const m = markOf(n)
  if (!m) return null
  const Icon = m.icon
  return <Icon aria-label={m.label} data-workspace-mark className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} style={m.tint ? { color: m.tint } : undefined} />
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

