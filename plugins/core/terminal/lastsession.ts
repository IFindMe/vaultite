import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { plugin } from "./shared.ts"
import { agentOf } from "./backends.ts"
import { stateHeard, terms } from "./terms.ts"
import { exitHeard } from "./routes.ts"

const KeptSessions = z.record(z.string(), z.string().min(1))
const SessionId = z.string().catch("")
const file = () => path.join(plugin.localDir(), "agent-sessions.json")
let kept: Map<string, string> | null = null
function all() {
  if (kept) return kept
  try { kept = new Map(Object.entries(KeptSessions.parse(JSON.parse(fs.readFileSync(file(), "utf8"))))) } catch { kept = new Map() }
  return kept
}
let writing: ReturnType<typeof setTimeout> | null = null
function save() {
  writing ??= setTimeout(() => {
    writing = null
    try { fs.mkdirSync(plugin.localDir(), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(Object.fromEntries([...all()].slice(-500)))) } catch { return }
  }, 1000)
  writing.unref?.()
}

export async function lastSession(id: string): Promise<string | null> {
  const a = agentOf(id), sid = all().get(id)
  if (!a || a.resume || !sid) return null
  const there = await plugin.ask<unknown>(`agent-session:${a.name}`, null, sid).catch(() => null)
  return there ? sid : null
}

const asking = new Set<string>()
async function note(id: string) {
  const a = agentOf(id), state = terms.get(id)?.phase.state
  if (!a || a.resume || asking.has(id) || (state !== "idle" && state !== "working" && state !== "blocked")) return
  asking.add(id)
  try {
    const sid = SessionId.parse(await plugin.ask<unknown>(`agent-session-in:${a.name}`, "", id).catch(() => ""))
    if (!sid || all().get(id) === sid) return
    all().delete(id)
    all().set(id, sid)
    save()
  } finally { asking.delete(id) }
}

function ended(id: string) {
  const p = terms.get(id)?.phase
  if (p?.state === "ended" && p.by && !p.by.keep && all().delete(id)) save()
}

export function keepAgentSessions() {
  const heard = (id: string) => void note(id)
  stateHeard.add(heard)
  exitHeard.add(ended)
  plugin.onUnload(() => { stateHeard.delete(heard); exitHeard.delete(ended) })
}
