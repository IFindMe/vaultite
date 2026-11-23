import { androidKeyboard } from "@/core/keyboard"

const OVER_THE_PAGE = "dialog[open], [role=dialog], [role=menu], [data-palette]"
const FOCUSABLE = "input, textarea, select, button, [href], [tabindex]:not([tabindex='-1'])"
const openAndLive = (el: HTMLElement) => el.checkVisibility() && !el.closest("[inert]")
const sheetHistoryPops = (el: HTMLElement) => el.matches("dialog[aria-labelledby=sheet-title]") && !!history.state?.sheet
const focusForTheShellsEscape = (top: HTMLElement) => {
  if (!top.contains(document.activeElement)) top.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true })
}
addEventListener("vaultite:system-back", (e) => {
  const top = [...document.querySelectorAll<HTMLElement>(OVER_THE_PAGE)].filter(openAndLive).at(-1)
  if (!top || sheetHistoryPops(top)) return
  e.preventDefault()
  focusForTheShellsEscape(top)
})

addEventListener("vaultite:keyboard", (e) => androidKeyboard(e instanceof CustomEvent && e.detail?.up === true))
