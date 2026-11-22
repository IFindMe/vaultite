import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const KEEP_RUNS_DAYS = 14
export const KEEP_RUNS_BYTES_LEAST_RECENT_GO_FIRST = 4 * 1024 ** 3
export const PRUNE_EVERY_MS = 3600_000

export const frameHash = (bitmap: Buffer) => crypto.createHash("sha256").update(bitmap).digest("base64")

const RECENT_FRAMES_MATCHED_PAST_A_BLINKING_CARET = 4
const keptFramesByTab = new Map<number, { run: string; frames: { hash: string; shot: string }[] }>()
export function repeatOf(tab: number, run: string, hash: string) {
  const was = keptFramesByTab.get(tab)
  return was?.run === run ? was.frames.find((f) => f.hash === hash)?.shot ?? null : null
}
export function keptFrame(tab: number, run: string, hash: string, shot: string) {
  const was = keptFramesByTab.get(tab)
  keptFramesByTab.set(tab, { run, frames: [{ hash, shot }, ...(was?.run === run ? was.frames : [])].slice(0, RECENT_FRAMES_MATCHED_PAST_A_BLINKING_CARET) })
}
export const forgetFrames = (tab: number) => { keptFramesByTab.delete(tab) }
const forgetRun = (run: string) => { for (const [tab, f] of keptFramesByTab) if (f.run === run) keptFramesByTab.delete(tab) }

export type RunOnDisk = { name: string; bytes: number; at: number }

export function runsToPruneKeepingLatest(runs: RunOnDisk[], now: number, keepDays = KEEP_RUNS_DAYS, keepBytes = KEEP_RUNS_BYTES_LEAST_RECENT_GO_FIRST) {
  const old = now - keepDays * 86400_000
  const dated = (r: RunOnDisk) => { const day = Date.parse(r.name.slice(0, 10)); return !Number.isFinite(day) || day >= old }
  const gone = runs.flatMap((r) => dated(r) ? [] : [r.name])
  let total = 0
  for (const [i, r] of runs.filter(dated).sort((a, b) => b.at - a.at).entries()) {
    total += r.bytes
    if (i > 0 && total > keepBytes) gone.push(r.name)
  }
  return gone
}

async function sizeOf(dir: string): Promise<RunOnDisk | null> {
  const files = await fs.promises.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => null)
  if (!files) return null
  let bytes = 0, at = 0
  for (const f of files) {
    if (!f.isFile()) continue
    const st = await fs.promises.stat(path.join(f.parentPath, f.name)).catch(() => null)
    if (!st) continue
    bytes += st.size
    at = Math.max(at, st.mtimeMs)
  }
  return { name: path.basename(dir), bytes, at }
}

export async function pruneRuns(root: string, now = Date.now(), keepDays = KEEP_RUNS_DAYS, keepBytes = KEEP_RUNS_BYTES_LEAST_RECENT_GO_FIRST) {
  const names = await fs.promises.readdir(root).catch(() => Array<string>())
  const runs: RunOnDisk[] = []
  for (const n of names) {
    const r = await sizeOf(path.join(root, n))
    if (r) runs.push(r)
  }
  const gone = runsToPruneKeepingLatest(runs, now, keepDays, keepBytes)
  for (const n of gone) {
    forgetRun(n)
    await fs.promises.rm(path.join(root, n), { recursive: true, force: true }).catch(() => {})
  }
  return gone
}
