import { notify, webPages, type WebSite } from "@vaultite"
import { holdsAccount, refusedAccount } from "./googleaccount"
import { allLogins, isIn, moveLogin, nameOf, type Logins } from "./loginsets"

const REFUSED = /^https:\/\/accounts\.google\.com\/(v3\/)?signin\/rejected\b/
const told = new Set<number>()

export const refusedByGoogle = (url: string) => REFUSED.test(url)

export function retryOf(url: string) {
  try {
    const to = new URL(url).searchParams.get("continue") ?? ""
    return /^https:\/\//i.test(to) ? to : "https://accounts.google.com/"
  } catch { return "https://accounts.google.com/" }
}

const googleIn = (sites: WebSite[] | undefined) => sites?.find((s) => s.site === "google.com" && isIn(s))
const googleOf = async (l: Logins) => googleIn(await webPages?.sites?.(l.prof).catch(() => []))

async function signedInAs(who: string, here: Logins): Promise<{ from: Logins; site: WebSite } | null> {
  for (const from of allLogins()) {
    if (from.prof === here.prof) continue
    const site = await googleOf(from)
    if (site && holdsAccount(site, who)) return { from, site }
  }
  return null
}

export async function googleRefused(id: number, url: string, container: string | null) {
  if (!refusedByGoogle(url)) { told.delete(id); return }
  if (told.has(id)) return
  told.add(id)
  const here = allLogins().find((l) => l.container === container)
  if (!here) return
  const who = refusedAccount(url, await googleOf(here))
  const found = who ? await signedInAs(who, here) : null
  if (!who || !found) return
  const { from, site } = found
  notify(`Google refused ${who} here. Copy its login from ${nameOf(from)} and try again?`, {
    duration: 30_000,
    action: { label: "Copy and retry", run: async () => { if (await moveLogin(from, here, site, true, { quiet: true }) === "moved") await webPages?.go(id, "load", retryOf(url)) } },
  })
}
