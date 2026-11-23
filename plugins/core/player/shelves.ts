
export type Shelf = "watch" | "listen" | "read"
export type Place = { t: number; d?: number; at: number; done?: boolean; marks?: Mark[] }
export type Mark = { t: number; note?: string }
export type Chapter = { t: number; title: string }

export const VIDEO = /\.(mp4|m4v|mov|webm|ogv)$/i
export const AUDIO = /\.(mp3|m4a|m4b|aac|wav|ogg|oga|opus|flac)$/i

export function mediaIn(body: string): string | null {
  for (const m of body.matchAll(/!\[\[([^\]|#]+)[^\]]*\]\]/g)) if (VIDEO.test(m[1]) || AUDIO.test(m[1])) return m[1].trim()
  return null
}

export function shelfOf(r: { body?: string; source?: string; from?: string }): { shelf: Shelf; media: string | null } | null {
  const media = mediaIn(r.body ?? "")
  if (media) return /^voice$/i.test(r.from ?? "") ? null : { shelf: VIDEO.test(media) ? "watch" : "listen", media }
  return /^https?:\/\//.test(r.source ?? "") ? { shelf: "read", media: null } : null
}

export function leftText(p: Place | undefined, d?: number) {
  const len = p?.d ?? d
  if (p?.done) return "done"
  const mins = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`)
  if (len && p && p.t > 5) return `${mins(len - p.t)} left`
  return len ? mins(len) : ""
}

export function secondsOfWrittenTime(text: string): number | null {
  const s = text.trim().toLowerCase()
  if (/^\d+(\.\d+)?s?$/.test(s)) return Number.parseFloat(s)
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/.exec(s)
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s)
  return units && s ? Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0) : null
}
