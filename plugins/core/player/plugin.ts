import fs from "node:fs"
import * as z from "zod"
import { bullets, HTTPError, OpError, Plugin, section, Text, vaultPath } from "../../../core/plugins.ts"
import { isArchived, str, type Item } from "../../../core/vault.ts"
import { readMeta } from "./meta.ts"
import { AUDIO, leftText, secondsOfWrittenTime, shelfOf, VIDEO, type Mark, type Place, type Shelf } from "./shelves.ts"

export const plugin = new Plugin(import.meta.url)

const MAX = 500
type Marks = Record<string, Mark[]>
const MarkData = z.object({ t: z.number(), note: z.string().optional() })
const MarksFile = z.object({ marks: z.record(z.string(), z.array(MarkData).catch([])).catch({}) })
const PlaceData = z.object({ t: z.number().catch(0), d: z.number().optional().catch(undefined), at: z.number(), done: z.boolean().optional().catch(undefined), marks: z.array(MarkData).optional().catch(undefined) })
const OldPlaces = z.object({ places: z.record(z.string(), PlaceData.nullable().catch(null)).catch({}) })
const PlaceBody = z.object({ path: z.string().optional().catch(undefined), t: z.number().optional().catch(undefined), d: z.number().optional().catch(undefined), done: z.boolean().optional().catch(undefined) })
const MarksBody = z.object({ path: z.string(), marks: z.array(z.object({ t: z.number(), note: z.unknown().optional() }).nullable().catch(null)) })
const marksNow = (): Marks => MarksFile.parse(plugin.settings({}, "marks")).marks
function places(): Record<string, Place> {
  const all = { ...(plugin.kept<{ places?: Record<string, Place> }>("places", {}).places ?? {}) }, marks = marksNow()
  for (const [p, m] of Object.entries(marks)) if (Array.isArray(m) && m.length) all[p] = { ...(all[p] ?? { t: 0, at: 0 }), marks: m }
  return all
}
function save(all: Record<string, Place>) {
  const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX)
  plugin.keep("places", kept.length ? { places: Object.fromEntries(kept.map(([p, { marks: _m, ...at }]) => [p, at])) } : null, { shared: true })
  const marks: Marks = Object.fromEntries(Object.entries(all).filter(([, x]) => x.marks?.length).sort(([a], [b]) => a.localeCompare(b)).map(([p, x]) => [p, x.marks!]))
  if (JSON.stringify(marks) !== JSON.stringify(marksNow())) plugin.saveSettings(Object.keys(marks).length ? { marks } : null, "marks")
}

let lookedAt = ""
plugin.onSync((vault) => {
  const key = `${vault.path}:${vault.settingsVersion}`
  if (lookedAt === key) return
  lookedAt = key
  let old: Item | null
  try { old = plugin.readSettings("places") } catch { return }
  if (!old) return
  const had = places(), next = { ...had }
  for (const [p, x] of Object.entries(OldPlaces.parse(old).places)) {
    if (!x) continue
    const mine = had[p]
    next[p] = { ...(mine && mine.at >= x.at ? mine : x), ...(mine?.marks?.length || x.marks?.length ? { marks: mine?.marks?.length ? mine.marks : x.marks } : {}) }
  }
  save(next)
  plugin.saveSettings(null, "places")
})

plugin.route("GET", "player/places", () => ({ places: places() }))

plugin.route("PUT", "player/places", (req) => {
  const body = PlaceBody.safeParse(req.body)
  if (!body.success || !body.data.path) return { ok: false }
  const { path, t, d, done } = body.data
  const all = { ...places() }
  const was = all[path]
  const len = d !== undefined && Number.isFinite(d) && d > 0 ? d : was?.d
  const at = t !== undefined && Number.isFinite(t) ? Math.max(0, t) : was?.t ?? 0
  const finished = done ?? (len ? at >= len - Math.min(30, len * 0.05) : was?.done)
  all[path] = { t: finished && done === undefined ? 0 : at, ...(len ? { d: Math.round(len) } : {}), at: Date.now(), ...(finished ? { done: true } : {}), ...(was?.marks ? { marks: was.marks } : {}) }
  save(all)
  return { place: all[path] }
})

plugin.route("PUT", "player/marks", (req) => {
  const body = MarksBody.safeParse(req.body)
  if (!body.success || !body.data.path) return { ok: false }
  const { path, marks } = body.data
  const list = marks.flatMap((m) => (m && Number.isFinite(m.t) && m.t >= 0 ? [m] : [])).slice(0, 500)
    .map((m) => ({ t: Math.round(m.t), ...(typeof m.note === "string" && m.note.trim() ? { note: m.note.trim().slice(0, 500) } : {}) }))
    .sort((a, b) => a.t - b.t)
  const all = { ...places() }
  const was: Place = { ...(all[path] ?? { t: 0, at: Date.now() }) }
  delete was.marks
  all[path] = { ...was, at: Date.now(), ...(list.length ? { marks: list } : {}) }
  save(all)
  return { place: all[path] }
})

const placeText = (path: string, p: Place) => `${path} picks up at ${clockOf(p.t)} on every device${p.done ? " (marked done)" : ""}.`
const clockOf = (t: number) => `${t >= 3600 ? `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, "0")}` : Math.floor(t / 60)}:${String(Math.floor(t) % 60).padStart(2, "0")}`

plugin.op({
  id: "player.place",
  cli: "player place",
  mcp: true,
  summary: "Set where a video or sound in the vault picks up when it plays next, on every device (where the user stopped watching it elsewhere).",
  help: `The place the player keeps for a vault file, as if they had paused there: the next play on any device (the
phone, the Mac) starts from it. at is seconds or a time as written ("4:50", "1:02:03", "4m50s"); 0 starts it over.

  vau player place "Attachments/Workshop talk.mp4" 4:50
  vau player place Books/Lighthouse.m4b 1:02:03`,
  kind: "write",
  params: {
    path: { type: "string", required: true, description: "the video's or sound's path in the vault" },
    at: { type: "string", required: true, description: "where it picks up: seconds, or a time like 4:50 or 1:02:03" },
  },
  args: ["path", "at"],
  run: (p) => {
    const rel = vaultPath(p.path, true, plugin.vault)
    if (!VIDEO.test(rel) && !AUDIO.test(rel)) throw new OpError(`${rel} isn't a video or a sound`)
    if (!fs.existsSync(plugin.vault.abs(rel))) throw new OpError(`${rel} isn't in the vault`, 404)
    const t = secondsOfWrittenTime(String(p.at))
    if (t === null) throw new OpError(`"${p.at}" isn't a time: give seconds (290) or a time like 4:50`)
    const all = { ...places() }
    const place: Place = { ...all[rel], t: Math.round(t), at: Date.now() }
    delete place.done
    all[rel] = place
    save(all)
    return { path: rel, place: all[rel] }
  },
  text: (r: { path: string; place: Place }) => placeText(r.path, r.place),
  did: (p) => ({ action: "edit", text: `Set ${String(p.path).slice(0, 120)} to pick up at ${p.at}` }),
})

function meta(rel: string, _version: string) { return readMeta(plugin.vault.abs(rel)) }
const metaOf = (rel: string) => {
  const st = fs.statSync(plugin.vault.abs(rel))
  return plugin.memo(86_400, meta, rel, `${st.size}:${st.mtimeMs}`)
}
const mediaPath = (p: unknown) => {
  const rel = vaultPath(p, true, plugin.vault)
  if (!AUDIO_OR_VIDEO.test(rel)) throw new HTTPError(400, `${rel} isn't audio or video`)
  return rel
}
const AUDIO_OR_VIDEO = /\.(mp3|m4a|m4b|aac|mp4|m4v|mov)$/i

plugin.route("GET", "player/meta", async (req) => {
  const rel = mediaPath(req.query.path)
  try {
    const m = await metaOf(rel)
    return { title: m.title ?? null, artist: m.artist ?? null, chapters: m.chapters, cover: !!m.cover }
  } catch { return { title: null, artist: null, chapters: [], cover: false } }
})

plugin.route("GET", "player/cover", async (req) => {
  const cover = (await metaOf(mediaPath(req.query.path)).catch(() => null))?.cover
  if (!cover) throw new HTTPError(404, "no cover in it")
  return new Text(cover.bytes, cover.mime, { "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" })
})

plugin.onMove((from, to) => {
  const all = places()
  if (!all[from]) return
  const next = { ...all }
  if (to) next[to] = next[from]
  delete next[from]
  save(next)
})

const LABEL: Record<Shelf, string> = { watch: "Watch", listen: "Listen", read: "Read" }

plugin.block("queue", (ctx) => {
  const show = str(ctx.options.show) || "all"
  const all = places()
  const items = plugin.vault.items("inbox").filter((r) => r.status === "new" && !isArchived(r))
    .map((r) => ({ r, s: shelfOf({ body: str(r.body), source: str(r.source), from: str(r.from) }) }))
    .filter((x): x is { r: Item; s: NonNullable<ReturnType<typeof shelfOf>> } => !!x.s && (show === "all" || x.s.shelf === show))
  ctx.source(items.map((x) => x.r))
  const line = ({ r, s }: (typeof items)[number]) => {
    const path = s.media ? plugin.vault.resolveLink(s.media, `${r.id}.md`) : null
    const left = path ? leftText(all[path]) : ""
    return `[[${r.id}|${r.title}]]${left ? ` (${left})` : ""}`
  }
  const shelves = (["watch", "listen", "read"] satisfies Shelf[]).filter((k) => show === "all" || show === k)
  const parts = shelves.map((k) => [k, items.filter((x) => x.s.shelf === k)] as const).filter(([, xs]) => xs.length)
    .map(([k, xs]) => `${LABEL[k]}:\n${bullets(xs.map(line))}`)
  return section("Queue", ...(parts.length ? parts : ["_Nothing waiting._"]))
})
