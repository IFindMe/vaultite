import { useState, type MouseEvent, type ReactNode } from "react"
import {
  cn, colorVar, Empty, FilterField, focusedPane, GroupLabel, menuFor, PageHeader, panesOf, placesIn, plural, selectPane, useTabLabels, type MenuItem, type Pane, type Store, type Tab, type TabGroup,
  type TabInfo,
} from "@vaultite"
import { Mark } from "./Mark"
import { tintWash } from "./tint"
import { ALL_TABS, current, label, listsOf, lookOf, moveBetween, showTab, SLOTS, slots, useVersion } from "./state"

type TabRun = { group?: TabGroup; tabs: Tab[] }
type Desk = { n: number; lists: TabRun[][]; count: number }
type Info = (t: Tab | Pane) => TabInfo
type Keep = (t: Tab, group?: TabGroup) => boolean
const hasWords = (q: string, text: string) => { const t = text.toLowerCase(); return q.toLowerCase().split(/\s+/).every((w) => t.includes(w)) }
const listed = (t: Tab) => !["new", `view:${ALL_TABS}`].includes(focusedPane(t).to)

function runsOf(tabs: Tab[], groups: TabGroup[], keep: Keep): TabRun[] {
  const runs: TabRun[] = []
  for (const t of tabs) {
    const last = runs[runs.length - 1], group = t.group ? groups.find((g) => g.id === t.group) : undefined
    if (!listed(t) || !keep(t, group)) continue
    if (last && last.group?.id === group?.id) last.tabs.push(t)
    else runs.push({ group, tabs: [t] })
  }
  return runs
}

function desksOf(here: number, keep: Keep): Desk[] {
  return SLOTS.filter((n) => n === here || slots()?.[n - 1]).map((n) => {
    const lists = listsOf(n).map((l) => runsOf(l.tabs, l.groups ?? [], keep))
    return { n, lists, count: lists.flat().reduce((sum, r) => sum + r.tabs.length, 0) }
  })
}

export default function AllTabs({ store }: { store: Store }) {
  useVersion()
  const info = useTabLabels(store)
  const [q, setQ] = useState("")
  const here = current(), query = q.trim()
  const matches: Keep = (t, g) => hasWords(query, [info(t).label, g?.name ?? "", ...placesIn(t).flatMap((p) => [info(p).label, p.to])].join("\n"))
  const desks = desksOf(here, () => true)
  const shown = query ? desksOf(here, matches) : desks
  const total = desks.reduce((sum, d) => sum + d.count, 0)
  const menu = (n: number, t: Tab) => (): MenuItem[] => desks.flatMap((d) => (d.n === n ? [] : [{ label: `Move to ${label(d.n)}`, run: () => void moveBetween(n, d.n, t.id) }]))
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
              {d.lists.map((runs, w) => (!runs.length ? null : (
                <div key={w} data-all-tabs-window={w}>
                  {w > 0 && <h3 className="px-1.5 pt-2 pb-1 text-[12px] font-medium text-muted-foreground">Pop-out window {w}</h3>}
                  {runs.map((r) => {
                    const rows = r.tabs.map((t) => <TabRow key={t.id} t={t} n={d.n} info={info} menu={menu(d.n, t)} />)
                    return r.group ? <GroupRun key={`${r.group.id}-${r.tabs[0].id}`} g={r.group} n={r.tabs.length}>{rows}</GroupRun> : rows
                  })}
                </div>
              )))}
            </section>
          ]))}
        </div>
      )}
    </div>
  )
}

function GroupRun({ g, n, children }: { g: TabGroup; n: number; children: ReactNode }) {
  return (
    <div data-all-tabs-group={g.id} className="py-0.5">
      <div className="flex h-7 items-center gap-2 px-1.5">
        <GroupLabel g={{ ...g, collapsed: false }} className="max-w-40" />
        <span className="text-[12px] text-muted-foreground tabular-nums">{n}</span>
      </div>
      <div className="ml-3 border-l-2 pl-1" style={{ borderColor: colorVar(g.color) }}>{children}</div>
    </div>
  )
}

const ROW = "flex h-8 min-w-0 cursor-pointer items-center gap-2 px-1.5 text-left text-[13px] hover:bg-foreground/[0.06]"

function Label({ i }: { i: TabInfo }) {
  const mark = i.mark
  return <>
    <i.icon className={cn("size-4 shrink-0", !i.tint && "text-muted-foreground", i.iconClassName)} strokeWidth={2} style={i.tint ? { color: i.tint } : undefined} />
    <span className="min-w-0 flex-1 truncate">{i.label}</span>
    {mark && <mark.icon aria-label={mark.label} data-all-tabs-mark className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} style={mark.tint ? { color: mark.tint } : undefined} />}
  </>
}

function TabRow({ t, n, info, menu }: { t: Tab; n: number; info: Info; menu: () => MenuItem[] }) {
  const ps = panesOf(t).filter((p) => !p.float)
  const open = (e: MouseEvent, pane?: string) => { e.preventDefault(); showTab(n, t.id); if (pane) selectPane(pane) }
  if (ps.length < 2) {
    return (
      <button type="button" data-all-tabs-tab={t.id} onClick={open} onContextMenu={menuFor(menu)} className={cn(ROW, "w-full rounded-[6px]")}>
        <Label i={info(t)} />
      </button>
    )
  }
  return (
    <div data-all-tabs-tab={t.id} data-all-tabs-split="" role="group" aria-label={`Split: ${ps.map((p) => info(p).label).join(", ")}`} onContextMenu={menuFor(menu)}
      className="flex h-8 overflow-hidden rounded-[6px] ring-1 ring-foreground/15 ring-inset">
      {ps.map((p, i) => (
        <button key={p.id} type="button" data-all-tabs-pane={p.id} data-tip={info(p).label} onClick={(e) => open(e, p.id)}
          className={cn(ROW, "flex-1 basis-0", i && "border-l border-foreground/15")}>
          <Label i={info(p)} />
        </button>
      ))}
    </div>
  )
}
