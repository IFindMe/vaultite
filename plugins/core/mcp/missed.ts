import { z } from "zod"
import { localDate, localTime } from "../../../core/plugins.ts"

export const MISSED = z.object({
  since: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
  until: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
  total: z.number().int().positive(),
  apps: z.record(z.string(), z.number().int().nonnegative()).catch({}),
})
export type Missed = z.infer<typeof MISSED>

const MIN_MISSED_NOT_NOISE = 3

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const dayOf = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`

function whoTried(apps: Record<string, number>): string {
  const named = Object.entries(apps).filter(([app, n]) => app !== "other" && n > 0).sort((a, b) => b[1] - a[1]).map(([app]) => app)
  if (!named.length) return "Apps"
  const all = (apps.other ?? 0) > 0 ? [...named, "other apps"] : named
  return all.length === 1 ? all[0] : `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`
}

function when(since: Date, until: Date, now: Date): string {
  const sameDay = localDate(since) === localDate(until), today = localDate(until) === localDate(now)
  const span = localTime(since) === localTime(until) && sameDay ? localTime(until) : `${localTime(since)}–${localTime(until)}`
  if (!sameDay) return `${dayOf(since)} ${localTime(since)} – ${dayOf(until)} ${localTime(until)}`
  return today ? span : `${dayOf(until)}, ${span}`
}

export function missedText(m: Missed, machine: "Mac" | "computer", now = new Date()): string {
  const times = m.total === 1 ? "once" : `${m.total} times`
  return `${whoTried(m.apps)} tried to reach this ${machine} ${times} while it was asleep or offline (${when(new Date(m.since), new Date(m.until), now)})`
}

export const noticeOf = (m: Missed, machine: "Mac" | "computer") => (m.total < MIN_MISSED_NOT_NOISE ? null : missedText(m, machine))
