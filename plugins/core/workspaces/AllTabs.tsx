import { useState, type MouseEvent } from "react"
import { cn, Empty, FilterField, focusedPane, menuFor, PageHeader, placesIn, plural, useTabLabels, type MenuItem, type Store, type Tab } from "@vaultite"
import { Mark } from "./Mark"
import { ALL_TABS, current, label, lookOf, moveBetween, showTab, SLOTS, slots, tabsOf, useVersion } from "./state"

type Desk = { n: number; tabs: Tab[] }
const hasWords = (q: string, text: string) => { const t = text.toLowerCase(); return q.toLowerCase().split(/\s+/).every((w) => t.includes(w)) }

export function AllTabs({ store }: { store: Store }) {
  useVersion()
  const info = useTabLabels(store)
  const [q, setQ] = useState("")
  const here = current()
  const desks: Desk[] = SLOTS.filter((n) => n === here || slots()?.[n - 1])
    .map((n) => ({ n, tabs: tabsOf(n).filter((t) => !["new", `view:${ALL_TABS}`].includes(focusedPane(t).to)) }))
  const total = desks.reduce((sum, d) => sum + d.tabs.length, 0)
  const query = q.trim()
  const shown = desks.map((d) => ({ ...d, tabs: query ? d.tabs.filter((t) => hasWords(query, [info(t).label, ...placesIn(t).map((p) => p.to)].join("\n"))) : d.tabs }))
  const menu = (n: number, t: Tab) => (): MenuItem[] => desks.flatMap((d) => (d.n === n ? [] : [{ label: `Move to ${label(d.n)}`, run: () => void moveBetween(n, d.n, t.id) }]))
  return (
    <div data-all-tabs className="mx-auto max-w-[1100px] pb-10">
      <PageHeader title="All tabs" subtitle={`${plural(total, "tab")} in ${plural(desks.length, "workspace")}`}>
        <FilterField value={q} onChange={setQ} placeholder="Filter tabs" className="max-w-64 basis-48" />
      </PageHeader>
      {query && shown.every((d) => !d.tabs.length) ? <Empty>No tabs match "{query}".</Empty> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] items-start gap-3">
          {shown.flatMap((d) => (query && !d.tabs.length ? [] : [
            <section key={d.n} data-all-tabs-workspace={d.n} className={cn("glass rounded-[12px] p-2", d.n === here && "ring-1 ring-primary/40")}>
              <div className="flex items-center gap-2 px-1.5 pt-1 pb-2">
                <Mark n={d.n} {...lookOf(d.n)} look="border border-border font-medium text-foreground" />
                <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{label(d.n)}</h2>
                <span className="text-[12px] text-muted-foreground">{d.n === here ? `This one · ${d.tabs.length}` : d.tabs.length}</span>
              </div>
              {!d.tabs.length && <p className="px-1.5 pb-1.5 text-[13px] text-muted-foreground">No tabs</p>}
              {d.tabs.map((t) => <TabRow key={t.id} t={t} n={d.n} store={store} menu={menu(d.n, t)} />)}
            </section>
          ]))}
        </div>
      )}
    </div>
  )
}

function TabRow({ t, n, store, menu }: { t: Tab; n: number; store: Store; menu: () => MenuItem[] }) {
  const i = useTabLabels(store)(t)
  const Icon = i.icon, mark = i.mark
  const open = (e: MouseEvent) => { e.preventDefault(); showTab(n, t.id) }
  return (
    <button type="button" data-all-tabs-tab={t.id} onClick={open} onContextMenu={menuFor(menu)}
      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-[6px] px-1.5 text-left text-[13px] hover:bg-foreground/[0.06]">
      <Icon className={cn("size-4 shrink-0", !i.tint && "text-muted-foreground", i.iconClassName)} strokeWidth={2} style={i.tint ? { color: i.tint } : undefined} />
      <span className="min-w-0 flex-1 truncate">{i.label}</span>
      {mark && <mark.icon aria-label={mark.label} data-all-tabs-mark className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} style={mark.tint ? { color: mark.tint } : undefined} />}
    </button>
  )
}
