// keys.swift heard events made here, never posted: each argument is a key's press ("+ctrl", "-opt", "key", "esc", "scroll"),
// in order, its watched keys first ("chords=control_option" "keys=61"). It prints what the tap says.
import AppKit

let HELD: [String: (Int64, CGEventFlags)] = ["ctrl": (59, .maskControl), "opt": (58, .maskAlternate), "ropt": (61, .maskAlternate), "shift": (56, .maskShift), "cmd": (55, .maskCommand), "fn": (63, .maskSecondaryFn)]
var down = Set<String>()
func flags() -> CGEventFlags { down.reduce(into: CGEventFlags()) { $0.formUnion(HELD[$1]!.1) } }
func event(_ type: CGEventType, _ code: Int64) {
  let e = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: true)!
  e.type = type
  e.flags = flags()
  tapped(type, e)
}
for a in CommandLine.arguments.dropFirst() {
  if a.hasPrefix("chords=") { chords = a.dropFirst(7).split(separator: ",").map(String.init) }
  else if a.hasPrefix("keys=") { watching = Set(a.dropFirst(5).split(separator: ",").compactMap { Int64($0) }) }
  else if a == "key" { event(.keyDown, 0) }
  else if a == "esc" { event(.keyDown, 53) }
  else if a == "scroll" { event(.scrollWheel, 0) }
  else {
    let name = String(a.dropFirst())
    if a.hasPrefix("+") { down.insert(name) } else { down.remove(name) }
    event(.flagsChanged, HELD[name]!.0)
  }
}
