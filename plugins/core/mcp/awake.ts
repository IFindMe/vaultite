import { type ChildProcess, execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export type Holder = { cmd: string; args: string[] }

const POWER = "/sys/class/power_supply", PERIPHERAL = "Device"

function ownBattery(): boolean {
  try {
    return fs.readdirSync(POWER).some((d) => {
      const read = (f: string) => { try { return fs.readFileSync(path.join(POWER, d, f), "utf8").trim() } catch { return "" } }
      return read("type") === "Battery" && read("scope") !== PERIPHERAL
    })
  } catch { return false }
}

function onPath(cmd: string): boolean {
  try { execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore", timeout: 3000 }); return true } catch { return false }
}

const NO_SLEEP_ON_AC = "-s", UNTIL_PID_EXITS = "-w"

export function holderFor(platform: string = process.platform, pid = process.pid, linux = { battery: ownBattery, has: onPath }): Holder | null {
  if (platform === "darwin") return { cmd: "/usr/bin/caffeinate", args: [NO_SLEEP_ON_AC, UNTIL_PID_EXITS, String(pid)] }
  const alwaysPluggedIn = !linux.battery()
  if (platform === "linux" && alwaysPluggedIn && linux.has("systemd-inhibit") && linux.has("tail")) {
    return { cmd: "systemd-inhibit", args: ["--what=sleep:idle", "--who=Vaultite", "--why=AI apps reach this vault through Vaultite Cloud", "--mode=block", "tail", `--pid=${pid}`, "-f", "/dev/null"] }
  }
  return null
}

export class KeepAwake {
  find: () => Holder | null
  found: Holder | null | undefined
  child: ChildProcess | null = null
  problem = ""
  run: (h: Holder) => ChildProcess

  constructor(find: () => Holder | null = holderFor, run = (h: Holder) => spawn(h.cmd, h.args, { stdio: "ignore" })) {
    this.find = find
    this.run = run
  }

  get holder() { return this.found === undefined ? (this.found = this.find()) : this.found }
  get supported() { return !!this.holder }
  get holding() { return !!this.child }

  set(want: boolean) {
    if (!want) { this.problem = ""; return this.stop() }
    const holder = this.holder
    if (!holder || this.child || this.problem) return
    const child = this.run(holder), name = path.basename(holder.cmd)
    this.child = child
    const ended = (why: string) => {
      if (this.child !== child) return
      this.child = null
      this.problem = why
    }
    child.on("error", (e) => ended(`couldn't start ${name}: ${e.message}`))
    child.on("exit", (code, signal) => ended(`${name} ended (${signal ?? `exit ${code}`})`))
  }

  stop() {
    const c = this.child
    this.child = null
    if (c && c.exitCode === null && c.signalCode === null) c.kill()
  }
}
