import { useMemo, useRef, type ReactNode, type RefObject } from "react"
import { useStore } from "@/core/data"
import { placeBelow, useHoverCard, type HoverShown, type PlaceCard } from "@/core/hovercard"
import { tabMeta } from "@/core/phoneTabs"
import { focusedPane, type Pane, type Tab } from "../../../core/layout.ts"
import { Badged } from "@/components/kit"
import { Captioned, HoverCard } from "@/components/HoverCard"
import { TabPreview } from "@/components/TabPreview"
import type { TabInfo } from "@/components/Tabs"
import { cn } from "@/lib/utils"

function Face({ pane, shows, own }: { pane: Pane; shows: TabInfo; own: TabInfo }) {
  const { store } = useStore(), Icon = own.icon
  const icon = (
    <Badged on={own.badge}>
      <Icon className={cn("size-3.5 shrink-0", !own.tint && "text-muted-foreground", own.iconClassName)} strokeWidth={2.25} style={own.tint ? { color: own.tint } : undefined} />
    </Badged>
  )
  return <Captioned picture={store && <TabPreview store={store} pane={pane} info={shows} />} icon={icon} title={own.label} about={pane.to.startsWith("file:") ? tabMeta(pane.to) : null} />
}

export function TabCard({ shown, chip, tab, info, place = placeBelow }: { shown: HoverShown; chip: RefObject<HTMLElement | null>; tab: Tab; info: (t: Tab | Pane) => TabInfo
  place?: PlaceCard }) {
  const pane = focusedPane(tab)
  return (
    <HoverCard shown={shown} anchor={chip} place={place} data-tab-hover-card={tab.id}>
      <Face pane={pane} shows={info(pane)} own={info(tab)} />
    </HoverCard>
  )
}

export function HoverPreview({ to, info, off = false, place, children }: { to: string | null; info: TabInfo; off?: boolean; place: PlaceCard; children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null)
  const { shown, props } = useHoverCard(anchor, { off: off || !to })
  const pane = useMemo(() => ({ id: "", to: to ?? "" }), [to])
  return (
    <div ref={anchor} {...props}>
      {children}
      {shown && to && (
        <HoverCard shown={shown} anchor={anchor} place={place} data-target-hover-card={to}>
          <Face pane={pane} shows={info} own={info} />
        </HoverCard>
      )}
    </div>
  )
}
