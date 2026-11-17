import type { VaultTest } from "./harness.ts"
import type { Moment } from "../../../plugins/core/companion/types.ts"
import { exchanges } from "../../../plugins/core/companion/conversation.ts"

export default async ($: VaultTest) => {
  const now = 10_000_000
  const ask = (seq: number, t: number, text: string): Moment => ({ seq, t, kind: "ask", text, summoned: true, for: "Claude" })
  const edit = (seq: number, t: number, line: string): Moment => ({ seq, t, kind: "edit", path: "Notes/Plan.md", line: 3, hunks: [{ line: 3, added: [line], removed: [] }] })
  const page = exchanges([ask(1, now - 600_000, "tidy this"), edit(2, now - 599_000, "typing while it answers"), edit(3, now - 300_000, "ship on friday"),
    edit(4, now - 299_000, "with Alice"), edit(5, now - 100_000, "nobody answered this")], [
    { t: now - 599_500, as: "Claude", op: "say", text: "Tidied." }, { t: now - 598_000, as: "Claude", op: "done" },
    { t: now - 298_000, as: "Claude", op: "say", text: "Friday is a holiday." },
  ], [], "Claude", { reactions: true })
  $.check("companion: an ask's answer keeps what it said while you typed", page.length === 2 && page[0].said[0] === "Tidied.", page)
  $.check("companion: a burst of edits it answered on its own is one trigger above its answer, an unanswered one isn't shown",
    page[1]?.kind === "edit" && page[1].text === "ship on friday\nwith Alice" && page[1].said[0] === "Friday is a holiday." && page[1].where === "Notes/Plan, line 3", page[1])
  $.check("companion: without reactions (its prompt's talk), edits aren't exchanges",
    exchanges([edit(1, now, "x")], [{ t: now + 10, as: "Claude", op: "say", text: "hi" }], [], "Claude").length === 0)
  const drawing = (id: string, title: string, n: number) => ({ id, agent: "Claude", tint: "orange", t: now, marks: Array.from({ length: n }, () => ({ type: "paper" as const, title, w: 200, h: 100, items: [] })) })
  const drew = exchanges([ask(1, now - 600_000, "sketch the flow"), ask(2, now - 300_000, "and in words?")], [
    { t: now - 599_000, as: "Claude", op: "draw", text: "a paper on the screen", drawing: "d1" }, { t: now - 598_000, as: "Claude", op: "say", text: "Here." },
    { t: now - 590_000, as: "Claude", op: "draw", drawing: "d1" },
    { t: now - 299_000, as: "Claude", op: "say", text: "Sign in, then home." },
  ], [], "Claude", { drawn: [{ t: now - 599_000, drawing: drawing("d1", "Sign in", 1) }, { t: now - 590_000, drawing: drawing("d1", "Sign in", 2) }] })
  $.check("companion: an answer keeps its drawing as it left it, playable again from the chat",
    drew[0]?.drawings?.length === 1 && drew[0].drawings[0].id === "d1" && drew[0].drawings[0].title === "Sign in" && drew[0].drawings[0].marks === 2, drew[0])
  $.check("companion: a follow-up that only talks keeps its words in the chat, with no drawing of its own",
    drew[1]?.said[0] === "Sign in, then home." && !drew[1].drawings, drew[1])
}
