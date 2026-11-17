import { useRef, useState } from "react"
import { Pin, X } from "lucide-react"
import {
  closeTab, cn, colorVar, Empty, FilterField, focusedPane, foldGroupMoving, groupMenu, HeadingButton, isPopout, menuFor, PageHeader, panesOf, placesIn, plural, selectPane, SidebarRow,
  tabMenuOf, useGroupIn, useGroupLines, useGrowIn, useShrinkOut, useTabLabels, useTabLayout, type MenuItem, type Pane, type Store, type Tab, type TabGroup, type TabInfo, type TabList,
} from "@vaultite"
import { TabGroupRow } from "@plugins/tabs/grouprow"
import { Mark } from "./Mark"
import { tintWash } from "./tint"
import { closeIn, foldIn } from "./elsewhere"
import { ALL_TABS, current, label, listsOf, lookOf, moveBetween, showTab, SLOTS, slots, useVersion } from "./state"

type Shown = { l: TabList; tabs: Tab[] }
type Desk = { n: number; lists: Shown[]; count: number }
type Info = (t: Tab | Pane) => TabInfo
type Keep = (t: Tab, group?: TabGroup) => boolean
type Where = { n: number; thisWindow: boolean; otherWorkspace: boolean }
type Run = { group?: TabGroup; tabs: Tab[] }

const hasWords = (q: string, text: string) => { const t = text.toLowerCase(); return q.toLowerCase().split(/\s+/).every((w) => t.includes(w)) }
const listed = (t: Tab) => !["new", `view:${ALL_TABS}`].includes(focusedPane(t).to)
const groupOf = (l: TabList, t: Tab) => (t.group ? l.groups?.find((g) => g.id === t.group) : undefined)

function runsOf({ l, tabs }: Shown): Run[] {
  const runs: Run[] = []
  for (const t of tabs) {
    const last = runs[runs.length - 1], group = groupOf(l, t)
    if (last && last.group?.id === group?.id) last.tabs.push(t)
    else runs.push({ group, tabs: [t] })
  }
  return runs
}

function desksOf(here: number, keep: Keep): Desk[] {
  return SLOTS.filter((n) => n === here || slots()?.[n - 1]).map((n) => {
    const lists = listsOf(n).map((l) => ({ l, tabs: l.tabs.filter((t) => listed(t) && keep(t, groupOf(l, t))) }))
    return { n, lists, count: lists.reduce((sum, s) => sum + s.tabs.length, 0) }
  })
}

export default function AllTabs({ store }: { store: Store }) {
  useVersion()
  useTabLayout()
  const info = useTabLabels(store)
  const [q, setQ] = useState("")
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const here = current(), query = q.trim()
  const matches: Keep = (t, g) => hasWords(query, [info(t).label, g?.name ?? "", ...placesIn(t).flatMap((p) => [info(p).label, p.to])].join("\n"))
  const desks = desksOf(here, () => true)
  const shown = query ? desksOf(here, matches) : desks
  const total = desks.reduce((sum, d) => sum + d.count, 0)
  const moves = (n: number, t: Tab): MenuItem[] => desks.flatMap((d) => (d.n === n ? [] : [{ label: `Move to ${label(d.n)}`, run: () => void moveBetween(n, d.n, t.id) }]))
  const fold = (at: Where, g: TabGroup) => {
    if (at.thisWindow) foldGroupMoving(g.id)
    else if (at.otherWorkspace) foldIn(at.n, g.id)
    else setFolded((s) => { const next = new Set(s); if (!next.delete(g.id)) next.add(g.id); return next })
  }
  const isFolded = (at: Where, g: TabGroup) => !query && (at.thisWindow || at.otherWorkspace ? !!g.collapsed : !!g.collapsed !== folded.has(g.id))
  return (
    <div data-all-tabs className="mx-auto max-w-[1100px] pb-10">
      <PageHeader title="All tabs" subtitle={`${plural(total, "tab")} in ${plural(desks.length, "workspace")}`}>
        <FilterField value={q} onChange={setQ} placeholder="Filter tabs" className="max-w-64 basis-48" />
      </PageHeader>
      {query && shown.every((d) => !d.count) ? <Empty>No tabs match "{query}".</Empty> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] items-start gap-3">
          {shown.flatMap((d) => (query && !d.count ? [] : [
            <section key={d.n} data-all-tabs-workspace={d.n} style={tintWash(lookOf(d.n).tint, false)} className={cn("glass rounded-[12px] p-2", d.n === here && "ring-1 ring-primary/40")}>
              <div className="flex items-center gap-2 px-1.5 pt-1 pb-2">
                <Mark n={d.n} {...lookOf(d.n)} look="border border-border font-medium text-foreground" />
                <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{label(d.n)}</h2>
                <span className="text-[12px] text-muted-foreground">{d.n === here ? `This one · ${d.count}` : d.count}</span>
              </div>
              {!d.count && <p className="px-1.5 pb-1.5 text-[13px] text-muted-foreground">No tabs</p>}
              {d.lists.map((s, w) => (!s.tabs.length ? null : (
                <div key={w}>
                  {w > 0 && <h3 className="px-1.5 pt-2 pb-1 text-[12px] font-medium text-muted-foreground">Pop-out window {w}</h3>}
                  <TabRows s={s} w={w} at={{ n: d.n, thisWindow: d.n === here && w === 0 && !isPopout(), otherWorkspace: d.n !== here }} info={info}
                    folded={isFolded} fold={fold} moves={moves} />
                </div>
              )))}
            </section>,
          ]))}
        </div>
      )}
    </div>
  )
}

function TabRows({ s, w, at, info, folded, fold, moves }: { s: Shown; w: number; at: Where; info: Info; folded: (at: Where, g: TabGroup) => boolean
  fold: (at: Where, g: TabGroup) => void
  moves: (n: number, t: Tab) => MenuItem[] }) {
  const root = useRef<HTMLDivElement>(null)
  useGroupLines(root, "y")
  const row = (t: Tab, line?: string) => <Row key={t.id} t={t} at={at} info={info} active={!at.thisWindow && t.id === s.l.active} line={line} moves={moves(at.n, t)} />
  return (
    <div ref={root} data-all-tabs-window={w} className="relative flex flex-col gap-px">
      {runsOf(s).map((r) => {
        const g = r.group
        if (!g) return r.tabs.map((t) => row(t))
        const shut = folded(at, g)
        return (
          <div key={`${g.id}-${r.tabs[0].id}`} data-all-tabs-group={g.id} className="flex flex-col gap-px">
            <GroupHead g={{ ...g, collapsed: shut }} n={r.tabs.length} at={at} onFold={() => fold(at, g)} />
            {!shut && r.tabs.map((t) => row(t, g.id))}
          </div>
        )
      })}
    </div>
  )
}

function GroupHead({ g, n, at, onFold }: { g: TabGroup; n: number; at: Where; onFold: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useGroupIn(box, g.id)
  return (
    <div ref={box} data-line-head={g.id} style={{ "--line": colorVar(g.color) }} onContextMenu={at.thisWindow ? menuFor(() => groupMenu(g.id, "panel")) : undefined}>
      <TabGroupRow g={g} n={n} onFold={onFold} more={at.thisWindow} />
    </div>
  )
}

function Row({ t, at, info, active, line, moves }: { t: Tab; at: Where; info: Info; active: boolean; line?: string; moves: MenuItem[] }) {
  const box = useRef<HTMLDivElement>(null)
  useGrowIn(box, t)
  useShrinkOut(box, { tab: t.id })
  const ps = panesOf(t).filter((p) => !p.float), split = ps.length > 1, i = info(t)
  const closes = !t.pinned && (at.thisWindow || at.otherWorkspace)
  const close = () => { if (at.thisWindow) closeTab(t.id); else closeIn(at.n, t.id) }
  const click = (e: React.MouseEvent) => {
    if (e.button === 1) { if (closes) close(); return }
    const half = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-pane-half]")?.dataset.paneHalf : undefined
    showTab(at.n, t.id)
    if (half) selectPane(half)
  }
  const after = (items: MenuItem[]) => items.map((it, k) => (k ? it : { ...it, sep: true }))
  const menu = (): MenuItem[] => at.thisWindow ? [...tabMenuOf(t.id), ...after(moves)]
    : [...moves, ...(closes ? after([{ label: "Close tab", icon: X, run: close }]) : [])]
  return (
    <div ref={box} data-slide={t.id} data-in-group={at.thisWindow ? t.group : undefined} data-line-of={line} onContextMenu={menuFor(menu)}>
      <SidebarRow data-all-tabs-tab={t.id} data-all-tabs-split={split ? "" : undefined} icon={split ? undefined : i.icon} iconClassName={i.iconClassName} tint={i.tint}
        badge={split ? undefined : i.badge} mark={split ? undefined : i.mark} label={split ? <SplitCells ps={ps} info={info} /> : i.label} labelClassName={split ? "[mask-image:none]" : undefined}
        tip={split ? ps.map((p) => info(p).label).join(" | ") : undefined} open active={active} more className={cn(line && "ml-3.5")}
        swipe={() => (closes ? [{ label: "Close", icon: X, danger: true, run: close, removes: true }] : [])}
        actions={closes ? [<HeadingButton key="close" icon={X} label={`Close ${i.label}`} tip="Close tab" data-no-drag onClick={(e) => { e.preventDefault(); e.stopPropagation(); close() }} />] : undefined}
        onClick={click}>
        {t.pinned && <span className="grid size-5 shrink-0 place-items-center text-muted-foreground" aria-label="Pinned"><Pin className="size-3.5" strokeWidth={2} /></span>}
      </SidebarRow>
    </div>
  )
}

function SplitCells({ ps, info }: { ps: Pane[]; info: Info }) {
  return (
    <span className="-ml-1 flex w-full min-w-0 overflow-hidden rounded-[5px] ring-1 ring-foreground/15 ring-inset">
      {ps.map((p, k) => {
        const pi = info(p)
        return (
          <span key={p.id} data-pane-half={p.id} data-all-tabs-pane={p.id} data-tip={pi.label}
            className={cn("flex h-5.5 min-w-0 flex-1 basis-0 items-center gap-2 px-1 transition-colors hover:bg-foreground/[0.06]", k > 0 && "border-l border-foreground/15")}>
            <pi.icon className={cn("size-4 shrink-0", !pi.tint && "text-muted-foreground", pi.iconClassName)} strokeWidth={2} style={pi.tint ? { color: pi.tint } : undefined} />
            <span className="min-w-0 flex-1 truncate">{pi.label}</span>
          </span>
        )
      })}
    </span>
  )
}
