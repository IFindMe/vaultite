import { execFileSync } from "node:child_process"
import path from "node:path"
import type { VaultTest } from "./harness.ts"
import { SCREEN_EVENT } from "../../../electron/screenwire.ts"

export default async ({ check, tmp }: VaultTest) => {
  let tools = process.platform === "darwin"
  try { if (tools) execFileSync("/usr/bin/xcode-select", ["-p"], { stdio: "ignore" }) } catch { tools = false }
  if (!tools) return
  const { swiftHelper } = await import("../../../electron/swiftbuild.ts")
  const bin = await swiftHelper({ id: "keytap", sources: ["../tools/test/swift/keytap.swift", "keys.swift", "ax.swift"], macos: "13" }).build(path.join(tmp, "keytap"))
  const said = (...args: string[]) => execFileSync(bin, args, { encoding: "utf8" }).split("\n").filter(Boolean).map((l) => {
    const m = SCREEN_EVENT.parse(JSON.parse(l))
    if (m.event === "chord") return `${m.name} ${m.other ?? (m.on ? "down" : "up")}`
    if (m.event === "fn") return `fn ${m.other ?? (m.down ? "down" : "up")}`
    return m.event === "mod" ? `mod ${m.other ?? (m.on ? "down" : "up")}` : m.event
  }).join(", ")
  const CHORDS = "chords=control_option,fn_control"
  const is = (name: string, got: string, want: string) => check(name, got === want, got)

  is("key tap: ⌃⌥ held, it's down, and up as one is let go", said(CHORDS, "+ctrl", "+opt", "-opt", "-ctrl"), "control_option down, control_option up")
  is("key tap: fn bumped while ⌃⌥ is held is told, and the press goes on to its let-go", said(CHORDS, "+ctrl", "+opt", "+fn", "-fn", "-opt", "-ctrl"), "control_option down, control_option modifier, control_option up")
  is("key tap: …still held as ⌃⌥ is let go, it begins no fn⌃ press", said(CHORDS, "+ctrl", "+opt", "+fn", "-opt", "-ctrl", "-fn"), "control_option down, control_option modifier, control_option up")
  is("key tap: keys while ⌃⌥ is held are told once, Esc by itself, and its let-go still comes", said(CHORDS, "+ctrl", "+opt", "key", "key", "esc", "+shift", "-shift", "-opt", "-ctrl"),
    "control_option down, control_option key, control_option esc, control_option modifier, control_option up")
  is("key tap: Option bumped while fn⌃ dictates goes on; fn let go first begins no ⌃⌥ press", said(CHORDS, "+fn", "+ctrl", "+opt", "-fn", "-ctrl", "-opt"), "fn_control down, fn_control modifier, fn_control up")
  is("key tap: ⌃⌥⇧ with ⇧ let go first is no ⌃⌥ press", said(CHORDS, "+ctrl", "+shift", "+opt", "-shift", "-opt", "-ctrl"), "")
  is("key tap: ⌃⌥ pressed again after a press", said(CHORDS, "+ctrl", "+opt", "-opt", "+opt", "-opt", "-ctrl"), "control_option down, control_option up, control_option down, control_option up")
  is("key tap: fn with another modifier held is no press; alone, what comes with it is told once", said("keys=63", "+shift", "+fn", "-fn", "-shift", "+fn", "key", "key", "+shift", "-shift", "-fn"), "fn down, fn key, fn modifier, fn up")
  is("key tap: Control bumped while fn dictates begins no fn⌃ press of its own", said("keys=63", CHORDS, "+fn", "+ctrl", "-ctrl", "-fn"), "fn down, fn modifier, fn up")
  is("key tap: what comes with right Option is told by its kind, and its let-go still comes", said("keys=61", "+ropt", "scroll", "key", "+shift", "-shift", "-ropt"), "mod down, mod mouse, mod key, mod modifier, mod up")
}
