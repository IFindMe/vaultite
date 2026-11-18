import { Worker } from "node:worker_threads"
import { vaultHolder } from "./vaultholder.ts"

export type Watchdog = { stallMs: number; memStallMs: number; memMB: number; everyMs: number }
export const WATCHDOG: Watchdog = { stallMs: 30_000, memStallMs: 5000, memMB: 4096, everyMs: 1000 }

const WATCHER_JS = `
const { workerData: w } = process.getBuiltinModule("node:worker_threads"), fs = process.getBuiltinModule("node:fs")
const beat = new Int32Array(w.sab)
let seen = Atomics.load(beat, 0), since = performance.now(), last = since
setInterval(() => {
  const now = performance.now(), n = Atomics.load(beat, 0), watcherWasPaused = now - last > w.everyMs * 5
  if (n !== seen || watcherWasPaused) { seen = n; since = now }
  last = now
  const stalled = now - since, mb = process.memoryUsage.rss() / 1048576
  if (stalled < w.stallMs && !(stalled >= w.memStallMs && mb >= w.memMB)) return
  const d = new Date(), at = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().replace("T", " ").slice(0, 19)
  const size = Atomics.load(new Int32Array(w.holder, 0, 1), 0), by = new TextDecoder().decode(new Uint8Array(w.holder, 4, size).slice())
  fs.writeSync(2, at + " vaultite: watchdog: the main thread stalled " + Math.round(stalled / 1000) + " s (" + Math.round(mb) + " MB" +
    (by ? ", the vault held by " + by : "") + "): killed for its service manager to restart it\\n")
  process.kill(process.pid, "SIGKILL")
}, w.everyMs)
`

export function killWhenMainThreadStalls(o: Watchdog = WATCHDOG) {
  const sab = new SharedArrayBuffer(4), beat = new Int32Array(sab)
  setInterval(() => Atomics.add(beat, 0, 1), o.everyMs).unref()
  new Worker(WATCHER_JS, { eval: true, workerData: { sab, holder: vaultHolder, ...o } }).unref()
}
