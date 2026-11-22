import { execFile } from "node:child_process"
import { shellArgs } from "./launch.ts"
import { kindOf } from "./shells.ts"

const MARK = "__vaultite_path__"

export function loginPath(sh: string, env: Record<string, string>, ms = 8000): Promise<string | null> {
  if (process.platform === "win32" || kindOf(sh) !== "posix") return Promise.resolve(null)
  const args = shellArgs(sh, { command: `echo; echo ${MARK}; printenv PATH` }, true)
  return new Promise((resolve) => {
    execFile(sh, args, { env, cwd: env.HOME, timeout: ms, encoding: "utf8", maxBuffer: 1 << 20 }, (err, out) => {
      const lines = String(out ?? "").split(/\r?\n/), at = lines.lastIndexOf(MARK), found = at >= 0 ? lines[at + 1]?.trim() : ""
      resolve(!err && found ? found : null)
    })
  })
}

type Known = { path: string | null; at: number }
const ASK_AGAIN_AFTER_MS = 10 * 60_000
const known = new Map<string, Known>(), asking = new Map<string, Promise<Known>>()

function ask(sh: string, env: () => Record<string, string>): Promise<Known> {
  let p = asking.get(sh)
  if (!p) {
    p = loginPath(sh, env()).then((found) => {
      const k = { path: found ?? known.get(sh)?.path ?? null, at: Date.now() }
      known.set(sh, k)
      asking.delete(sh)
      return k
    })
    asking.set(sh, p)
  }
  return p
}

export async function cachedLoginPath(sh: string, env: () => Record<string, string>): Promise<string | null> {
  const k = known.get(sh)
  if (!k) return (await ask(sh, env)).path
  if (Date.now() - k.at > ASK_AGAIN_AFTER_MS) void ask(sh, env)
  return k.path
}
