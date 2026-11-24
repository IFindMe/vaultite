export const HOLD_MS = 450, DOUBLE_MS = 350
/** free: a double tap, hands-free: the session goes on till the next press. */
export type FnAction = "start" | "stop" | "cancel" | "free" | null

export const STRAYS = ["key", "modifier", "mouse", "esc"] as const
export type Stray = (typeof STRAYS)[number]

export function fnKey(hold = HOLD_MS, gap = DOUBLE_MS) {
  let at = 0, started = false, strayed = false, tapped = -Infinity, stopped = -Infinity
  return {
    /** fn went down; `listening`: a session is under way. `held`: already held long enough (Control's), so its release
     *  stops what it starts; held while one is under way, it's nothing. */
    down(now: number, listening: boolean, held = false): FnAction {
      if (held && listening) { started = false; return null }
      if (!held && listening && now - tapped <= gap) { tapped = -Infinity; started = false; return "free" }
      if (!held && !listening && now - stopped <= gap) { stopped = -Infinity; started = false; return null }
      at = held ? now - hold : now
      started = !listening
      strayed = false
      tapped = -Infinity
      if (listening) stopped = now
      return listening ? "stop" : "start"
    },
    up(now: number): FnAction {
      if (!started) return null
      started = false
      if (now - at >= hold) return "stop"
      if (strayed) return "cancel"
      tapped = now
      return null
    },
    /** Another key came with fn: a shortcut, if it's at once (a modifier alone isn't one yet, but then a tap is nothing);
     *  later, they're talking and it's not for dictation. `shortcut`: it is one whenever it comes (with Control). */
    other(now: number, kind: Stray = "key", shortcut = false): FnAction {
      if (!started) return null
      if (!shortcut && (kind === "modifier" || now - at >= hold)) { strayed = true; return null }
      started = false
      return "cancel"
    },
  }
}

/** macOS's "Press globe key to" (AppleFnUsageType): 0 Do nothing; else it acts too on each press (input source, emoji,
 *  its dictation). Unset reads as macOS's default, which acts. */
export const fnActsToo = (usage: string | null) => usage?.trim() !== "0"

// The keys the user picks (dictation's and the companion's `keys`), as the screen helper's tap knows them: a key alone
// by its code, a chord (two modifiers held together, nothing else) by its name.
const CODES: Record<string, number[]> = { fn: [63], right_option: [61], right_command: [54], left_control: [59], right_control: [62] }
const CONTROL = new Set([59, 62])
export const CHORDS = ["control_option", "fn_control"] as const
export const isChord = (k: string) => (CHORDS as readonly string[]).includes(k)
export const keyCodes = (keys: readonly string[]) => keys.flatMap((k) => CODES[k] ?? [])

/** How long a modifier must be alone before it counts: a chord's or a shortcut's key comes sooner, and starts nothing. */
export const ALONE_MS = 200

/** `t`: when the key moved (ms since 1970), if its tap said; else it's when heard. */
/** `double`: Control tapped twice, hands-free on (or off); `held`: Control's hold, long enough already. */
export type FnEvent = { down: boolean; t?: number; held?: boolean } | { other: Stray; t?: number; shortcut?: boolean } | { double: true }
/** What the tap says: a watched key's press or release (`alone`: nothing else held), or that something else came. */
export type ModEvent = { code?: number; on?: boolean; alone?: boolean; at?: number; other?: Stray; t?: number }
/** `fn`: what it means as fn's events; `wait`: call `settled` in that many ms. */
export type ModHeard = { fn: FnEvent[]; wait?: number }

/** Control is in every shortcut, so alone a tap of it is nothing: tapped twice (pressed within CONTROL_DOUBLE_MS, as
 *  Wispr Flow's) it's hands-free, and held alone past CONTROL_HOLD_MS it listens till let go. */
export const CONTROL_DOUBLE_MS = 500, CONTROL_HOLD_MS = 500

/** The modifiers picked (right Option, Control...), as fn's events: alone, it's fn itself, whatever comes once it counts
 *  told with it; with another key before, it's what it always was (an accent, Control+C). */
export function modKeys(keys: readonly string[]) {
  const codes = new Set(keyCodes(keys.filter((k) => k !== "fn")))
  let solo: { code: number; state: "waiting" | "down" | "dropped"; at: number; since: number } | null = null
  let tapped = -Infinity
  const strayed = (other: Stray, t?: number): FnEvent[] => {
    tapped = -Infinity
    if (!solo) return []
    if (solo.state === "down") return [{ other, t, shortcut: CONTROL.has(solo.code) }]
    solo.state = "dropped"
    return []
  }
  return {
    heard(m: ModEvent): ModHeard {
      const code = m.code ?? -1
      if (m.other || !codes.has(code) || (solo && solo.code !== code)) return { fn: strayed(m.other ?? "modifier", m.t) }
      const at = m.at ?? Date.now(), control = CONTROL.has(code)
      if (m.on) {
        solo = { code, state: m.alone ? "waiting" : "dropped", at, since: Infinity }
        if (!m.alone) tapped = -Infinity
        return { fn: [], ...(m.alone ? { wait: control ? CONTROL_HOLD_MS : ALONE_MS } : {}) }
      }
      const was = solo
      solo = null
      if (was?.state === "down") return { fn: [{ down: false }] }
      if (!control) return { fn: was?.state === "waiting" ? [{ down: true }, { down: false }] : [] }
      if (was?.state !== "waiting") { tapped = -Infinity; return { fn: [] } }
      if (was.at - tapped <= CONTROL_DOUBLE_MS) { tapped = -Infinity; return { fn: [{ double: true }] } }
      tapped = was.at
      return { fn: [] }
    },
    talking: (now: number) => solo?.state === "down" && (CONTROL.has(solo.code) || now - solo.since >= HOLD_MS),
    /** The `wait` after a press, still alone: its press counts now (Control's as a hold). */
    settled(): FnEvent[] {
      if (solo?.state !== "waiting") return []
      solo.state = "down"
      solo.since = Date.now()
      tapped = -Infinity
      return [CONTROL.has(solo.code) ? { down: true, held: true } : { down: true }]
    },
  }
}

// The Talk keys' gesture is HeyClicky's.
export const TAP_MS = 250
/** listen: its cursor at the pointer, hearing; send: what was said (and drawn) goes; type: a box to type in, nothing
 *  heard; free: hands-free, into that box; cancel: nothing goes. */
export type TalkAction = "listen" | "send" | "type" | "free" | "cancel" | null

const isShortcut = (kind: Stray, heldMs: number) => kind === "esc" || (kind === "key" && heldMs < HOLD_MS)

type TalkPhase = "idle" | "held" | "typed" | "freeing" | "free" | "freeDown" | "bounce"
export function talkGesture(tap = TAP_MS, gap = DOUBLE_MS) {
  let s: TalkPhase = "idle", at = 0, lastTap = -Infinity, quick = false, strayed = false, sent = -Infinity
  const to = (next: TalkPhase, a: TalkAction = null): TalkAction => { s = next; return a }
  const send = (now: number) => { sent = now; return to("idle", "send") }
  const bounces = (now: number) => now - sent <= gap
  function letGo(now: number): TalkAction {
    if (now - at >= tap) return send(now)
    if (strayed) return to("idle", "cancel")
    lastTap = now
    return to("typed", "type")
  }
  return {
    get state() { return s },
    get strayed() { return strayed },
    down(now: number): TalkAction {
      if (s === "typed" && now - lastTap <= gap) return to("freeing", "free")
      if (s === "free") { at = now; quick = now - lastTap <= gap; return to("freeDown") }
      if (s !== "idle" && s !== "typed") return null
      at = now
      strayed = false
      return bounces(now) ? to("bounce") : to("held", "listen")
    },
    /** Still down `tap` ms on (the helper's timer): a press that began as a bounce is held after all, and listens. */
    held: (): TalkAction => (s === "bounce" ? to("held", "listen") : null),
    up(now: number): TalkAction {
      if (s === "bounce") { sent = now; return to("idle") }
      if (s === "held") return letGo(now)
      if (s === "freeing") { lastTap = -Infinity; return to("free") }
      if (s !== "freeDown") return null
      if (now - at >= tap || quick) return send(now)
      lastTap = now
      return to("free")
    },
    other(now: number, kind: Stray = "key"): TalkAction {
      if (kind === "mouse") return null
      const shortcut = isShortcut(kind, now - at)
      if (s === "bounce" && shortcut) return to("idle")
      if (s === "freeDown" && now - at < HOLD_MS) return to("free")
      if (s === "held") strayed = true
      return s === "held" && shortcut ? to("idle", "cancel") : null
    },
    /** The exchange ended elsewhere (sent from its box, Esc, closed): the next press starts anew. */
    reset() { s = "idle"; lastTap = -Infinity },
  }
}
