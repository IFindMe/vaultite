import { useEffect, useState, type MouseEvent } from "react"
import { RotateCcw, Settings2, SlidersHorizontal } from "lucide-react"
import { Button, Group, notifyError, openMenu, openPluginSettings, Section, SettingRow, Segmented, useWorkspaceVersion, webPages, type MenuItem } from "@vaultite"
import { engine, type Choice, type PagePermissions, type SitePermission } from "./engine"
import { allLogins, nameOf } from "./loginsets"
import { useContainers } from "./containers"
import { kindIcon, kindName } from "./permissionkinds"
import { settings } from "./state"

const CHOICES: { value: Choice; label: string }[] = [{ value: "ask", label: "Ask" }, { value: "allow", label: "Allow" }, { value: "block", label: "Block" }]
const choiceNote = (kind: string, c: Choice) => c === "ask" ? "Asks the first time the site wants it"
  : c === "allow" ? (kind === "notifications" ? "Allowed unless you block it" : "Allowed without asking") : "Blocked: the site can't ask"

const setChoice = (profile: string, site: string, kind: string, choice: Choice) =>
  Promise.resolve(engine("permissions:set", profile, site, kind, choice)).catch((e) => notifyError(e, "Couldn't change it"))

function macItems(p: PagePermissions): MenuItem[] {
  return (["camera", "microphone"] as const).flatMap((k): MenuItem[] => p.mac[k] === "granted" ? [] : [{
    label: p.mac[k] === "not-determined" ? `Let Vaultite use the ${k}…` : `macOS blocks Vaultite's ${k}: open Settings…`,
    icon: Settings2, sep: true,
    run: () => void Promise.resolve(engine("permissions:mac", k)).catch((e) => notifyError(e, "Couldn't ask macOS")),
  }])
}

type Shown = Omit<PagePermissions, "kinds"> & { kinds: (PagePermissions["kinds"][number] & { was: Choice; default: Choice })[] }
function siteItems(p: Shown, reload: () => void): MenuItem[] {
  const changed = p.kinds.some((k) => k.choice !== k.was)
  return [
    { caption: true, label: `What ${p.site} may use`, run: () => {} },
    ...p.kinds.map((k): MenuItem => ({ label: kindName(k.kind), icon: kindIcon(k.kind), hint: CHOICES.find((c) => c.value === k.choice)?.label, run: () => {},
      items: [{ caption: true, label: choiceNote(k.kind, k.choice), run: () => {} }, ...CHOICES.map((c): MenuItem => ({ label: c.label, checked: k.choice === c.value, keep: true,
        run: () => { k.choice = c.value; void setChoice(p.profile, p.site, k.kind, c.value) } }))] })),
    ...macItems(p),
    ...(changed ? [{ label: "Reload to use the new settings", icon: RotateCcw, sep: true, run: reload }] : []),
    { label: "Reset permissions", icon: RotateCcw, sep: !changed, disabled: p.kinds.every((k) => k.choice === k.default),
      run: () => void Promise.resolve(engine("permissions:clear", p.profile, p.site)).then(reload, (e) => notifyError(e, "Couldn't reset them")) },
    { label: "Site permissions…", icon: Settings2, run: () => openPluginSettings("web-viewer", "permissions") },
  ]
}

export function SiteInfoButton({ id, url, loading }: { id: number; url: string; loading?: boolean }) {
  const [site, setSite] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    void engine("permissions:page", id).then((r) => { if (!gone) setSite(r?.site ?? null) }, () => {})
    return () => { gone = true }
  }, [id, url, loading])
  if (!webPages?.engine || !site) return null
  const open = async (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const p = await engine("permissions:page", id).catch(() => null)
    if (!p) return
    const kinds = p.kinds.map((k) => ({ ...k, was: k.choice, default: k.kind === "notifications" ? "allow" as const : "ask" as const }))
    const page = { ...p, kinds }
    const items = () => siteItems(page, () => void webPages?.go(id, "reload"))
    openMenu({ x: r.left, y: r.bottom + 4, flip: r.top - 4 }, items(), false, items)
  }
  return (
    <button type="button" aria-label={`Site information for ${site}`} aria-haspopup="menu" data-tip="Site information" data-web-site-info
      onClick={(e) => void open(e)}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground">
      <SlidersHorizontal className="size-3.5" strokeWidth={2} />
    </button>
  )
}

function useSitePermissions() {
  const [rows, setRows] = useState<SitePermission[] | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let gone = false
    void engine("permissions:list").then((r) => { if (!gone) setRows(r ?? []) }, () => { if (!gone) setRows([]) })
    return () => { gone = true }
  }, [version])
  return { rows, refresh: () => setVersion((v) => v + 1) }
}

export function PermissionsSettings() {
  useWorkspaceVersion()
  settings.use()
  useContainers()
  const { rows, refresh } = useSitePermissions()
  const logins = allLogins()
  const nameFor = (prof: string) => { const l = logins.find((x) => x.prof === prof); return l ? nameOf(l) : "Other logins" }
  const groups = new Map<string, SitePermission[]>()
  for (const r of rows ?? []) groups.set(`${r.profile} ${r.site}`, [...(groups.get(`${r.profile} ${r.site}`) ?? []), r])
  const multi = new Set((rows ?? []).map((r) => r.profile)).size > 1 || logins.length > 1
  return (
    <div data-setting="permissions">
      <Section title="Site permissions">
        {!webPages?.engine ? <p className="text-[15px] text-muted-foreground">Site permissions are in Vaultite's desktop app.</p> : (
          <div data-web-permissions-settings>
            {rows && !rows.length ? <p className="px-1 text-[13px] text-muted-foreground">No site has asked yet.</p> : (
              <Group>{[...groups.values()].flatMap((list) => list.map((r) => (
                <SettingRow key={`${r.profile} ${r.site} ${r.kind}`} chevron={null} data-web-permission={`${r.site} ${r.kind}`} label={r.site}
                  sub={`${kindName(r.kind)}${multi ? ` · ${nameFor(r.profile)}` : ""}`}>
                  <Segmented small label={`${kindName(r.kind)} for ${r.site}`} value={r.choice} options={CHOICES}
                    onChange={(c) => void setChoice(r.profile, r.site, r.kind, c).then(refresh)} />
                </SettingRow>
              )))}</Group>
            )}
            {!!rows?.length && <div className="mt-2"><Button size="small" onClick={() => void Promise.all([...groups.values()].map((l) => engine("permissions:clear", l[0].profile, l[0].site))).then(refresh, (e) => notifyError(e, "Couldn't reset them"))}>Reset all</Button></div>}
            <p className="mt-1.5 px-1 text-[13px] leading-[18px] text-muted-foreground">
              What each site may use: the camera, the microphone, your location, notifications. A site asks the first time; a page's site information button (left of Shields in its address bar) changes it there. Each container keeps its own.
            </p>
          </div>
        )}
      </Section>
    </div>
  )
}
