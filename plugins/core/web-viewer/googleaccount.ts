import type { WebSite } from "@vaultite"

export function refusedAccount(url: string, held?: WebSite): string | null {
  let typed = ""
  try { typed = new URL(url).searchParams.get("idnf") ?? "" } catch { typed = "" }
  return (typed || held?.account || "").toLowerCase() || null
}

export const holdsAccount = (s: WebSite, who: string) => [s.account, ...(s.more ?? [])].some((a) => a?.toLowerCase() === who)
