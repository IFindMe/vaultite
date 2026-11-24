// The dictation and Talk keys as the screen helper's tap hears them (compiled into screen.swift): each one's down and up,
// and what else came meanwhile (`other`), which never ends a press here: core/fnkey.ts decides.
import AppKit

/** The keys the helper asked for: alone by keycode, chords by name. */
let keysLock = NSLock()
var watching = Set<Int64>(), chords: [String] = []
func watched(_ code: Int64) -> Bool { keysLock.lock(); defer { keysLock.unlock() }; return watching.contains(code) }

let MODS: [Int64: CGEventFlags] = [59: .maskControl, 62: .maskControl, 61: .maskAlternate, 54: .maskCommand]
/** The key's other side's own flag (left Option's for right Option, right Control's for left): held with it, not alone. */
let LEFT: [Int64: UInt64] = [61: 0x20, 54: 0x08, 59: 0x2000, 62: 0x01]
let ANY_MOD: CGEventFlags = [.maskControl, .maskAlternate, .maskCommand, .maskShift, .maskSecondaryFn]

/** What came with a watched key (core/fnkey.ts Stray); each is told once a press. */
func stray(_ type: CGEventType, _ e: CGEvent) -> String {
  switch type {
  case .flagsChanged: return "modifier"
  case .keyDown: return e.getIntegerValueField(.keyboardEventKeycode) == 53 ? "esc" : "key"
  default: return "mouse"
  }
}
/** Ms since 1970: a busy app hearing an event late still tells a tap from a hold. */
func happenedAt() -> Double { Date().timeIntervalSince1970 * 1000 }

var modHeld = Set<Int64>(), modLive = false, modTold = Set<String>()
/** Control's and the right modifiers' presses as they are (core/fnkey.ts decides); what follows one says only that it came. */
func tappedMod(_ type: CGEventType, _ e: CGEvent) {
  let code = e.getIntegerValueField(.keyboardEventKeycode)
  guard type == .flagsChanged, let own = MODS[code], watched(code) else {
    let kind = stray(type, e)
    if modLive && modTold.insert(kind).inserted { send(["event": "mod", "other": kind, "t": happenedAt()]) }
    return
  }
  // (the flag stays while the key's other side is down: a held key's next event is its release)
  let on = e.flags.contains(own) && !modHeld.contains(code)
  let alone = on && modHeld.isEmpty && e.flags.intersection(ANY_MOD).subtracting(own).isEmpty && e.flags.rawValue & (LEFT[code] ?? 0) == 0
  if on { modHeld.insert(code) } else { modHeld.remove(code) }
  modLive = true
  modTold = []
  send(["event": "mod", "code": code, "on": on, "alone": alone, "at": DispatchTime.now().uptimeNanoseconds / 1_000_000])
}

var fnDown = false, fnTold = Set<String>()
/** fn: down only when it's alone (with another modifier held, it's a shortcut or a slip). */
func tappedFn(_ type: CGEventType, _ e: CGEvent) {
  if type == .flagsChanged && e.getIntegerValueField(.keyboardEventKeycode) == 63 {
    let on = e.flags.contains(.maskSecondaryFn)
    if on && !fnDown && watched(63) && e.flags.intersection(ANY_MOD) == .maskSecondaryFn { fnDown = true; fnTold = []; send(["event": "fn", "down": true]) }
    else if !on && fnDown { fnDown = false; send(["event": "fn", "down": false]) }
    return
  }
  guard fnDown, type == .flagsChanged || type == .keyDown else { return }
  let kind = stray(type, e)
  if fnTold.insert(kind).inserted { send(["event": "fn", "other": kind, "t": happenedAt()]) }
}

/** Chords: two modifiers held together and nothing else, by name (core/fnkey.ts CHORDS). One begins only as a modifier
 *  goes down (never as another chord's, or a shortcut's, are let go) and ends only as one of its own is let go. */
let CHORD_FLAGS: [String: CGEventFlags] = ["control_option": [.maskControl, .maskAlternate], "fn_control": [.maskSecondaryFn, .maskControl]]
var chordOn: [String: Bool] = [:], chordTold: [String: Set<String>] = [:], chordMods: CGEventFlags = []
func tappedChord(_ type: CGEventType, _ e: CGEvent) {
  guard type == .flagsChanged || type == .keyDown else { return }
  keysLock.lock(); let names = chords; keysLock.unlock()
  let mods = type == .flagsChanged ? e.flags.intersection(ANY_MOD) : chordMods, was = chordMods
  chordMods = mods
  for n in names {
    guard let f = CHORD_FLAGS[n] else { continue }
    if chordOn[n] == true {
      if !mods.isSuperset(of: f) { chordOn[n] = false; send(["event": "chord", "name": n, "on": false, "t": happenedAt()]); continue }
      let kind = stray(type, e)
      if type == .keyDown || mods != was, chordTold[n, default: []].insert(kind).inserted { send(["event": "chord", "name": n, "other": kind, "t": happenedAt()]) }
    } else if type == .flagsChanged && mods == f && mods != was && mods.isSuperset(of: was) && !(fnDown && f.contains(.maskSecondaryFn)) {
      chordOn[n] = true
      chordTold[n] = []
      send(["event": "chord", "name": n, "on": true, "t": happenedAt()])
    }
  }
}

func tapped(_ type: CGEventType, _ e: CGEvent) {
  tappedMod(type, e)
  tappedChord(type, e)
  tappedFn(type, e)
}

/** The Talk key's own modifiers, held now: a click replayed is a plain click (Control's would be a right click). */
func talkFlags() -> CGEventFlags {
  var f: CGEventFlags = []
  for c in modHeld { if let m = MODS[c] { f.formUnion(m) } }
  for (n, on) in chordOn where on { if let m = CHORD_FLAGS[n] { f.formUnion(m) } }
  if fnDown { f.formUnion(.maskSecondaryFn) }
  return f
}
