// When agents' browsing holds a restart (agent.ts' busy, engine.ts' engineBusy): a call under way always; a recent action
// for as long as what restarts would cost the agent. No Electron: tools/test_web.ts runs it.

/** How long after an agent's last action a restart waits. The server's costs it nothing it keeps (its tabs, asks, logins
 *  and steps are the app's, and vau sends a call the restart cut again); the app's reloads its pages. */
export const QUIET_AFTER = { server: 60_000, app: 10 * 60_000 } as const
export const ACTING_MS = 15_000

export type AgentWork = { calls: number; lastStep: number; seen: { calls: number; lastStep: number }; now: number }

const span = (ms: number) => (ms < 60_000 ? `${ms / 1000} s` : ms === 60_000 ? "minute" : `${ms / 60_000} minutes`)

export function agentBusy(of: "app" | "server", w: AgentWork): string | null {
  const { calls, lastStep } = of === "server" ? w.seen : w, where = of === "server" ? "a tab the user sees" : "a page"
  if (calls) return `an agent's call is under way in ${where}`
  return w.now - lastStep < QUIET_AFTER[of] ? `an agent acted in ${where} in the last ${span(QUIET_AFTER[of])}` : null
}

export function agentActing(w: AgentWork): string | null {
  if (w.seen.calls) return "an agent's call is under way in a tab the user sees"
  return w.now - w.seen.lastStep < ACTING_MS ? `an agent acted in a tab the user sees in the last ${span(ACTING_MS)}` : null
}
