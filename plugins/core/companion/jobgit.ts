import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { gitEnv } from "../../../core/plugins.ts"
import { commitsIn, type Marks } from "./jobs.ts"

const git = (cwd: string, args: string[]) => new Promise<string>((ok) => execFile("git", args, { cwd, timeout: 5000, maxBuffer: 4 << 20, env: gitEnv() }, (e, out) => ok(e ? "" : String(out))))
const statLine = (stat: string) => {
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(stat)
  return m ? `${m[1]} file${m[1] === "1" ? "" : "s"} changed, +${m[2] ?? 0} -${m[3] ?? 0}` : ""
}
export async function diffSince(cwd: string, base: string, landed = "", gone = false) {
  if (landed && await gitOk(cwd, ["cat-file", "-e", `${landed}^{commit}`])) return statLine(await git(cwd, ["show", "--shortstat", "--format=", landed]))
  if (!base || gone || !(await gitOk(cwd, ["merge-base", "--is-ancestor", base, "HEAD"]))) return ""
  const from = await fromOf(cwd, base)
  const [stat, fresh, commits] = await Promise.all([git(cwd, ["diff", "--shortstat", from]), git(cwd, ["ls-files", "--others", "--exclude-standard"]), git(cwd, ["rev-list", "--count", `${from}..HEAD`])])
  const n = fresh.split("\n").filter(Boolean).length, c = Number(commits.trim()) || 0
  return [statLine(stat), n ? `${n} new file${n > 1 ? "s" : ""}` : "", c ? `${c} commit${c > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ")
}
async function fromOf(cwd: string, base: string) {
  const main = await mainOf(cwd), on = main ? (await git(cwd, ["merge-base", main, "HEAD"])).trim() : ""
  return on && on !== base && await gitOk(cwd, ["merge-base", "--is-ancestor", base, on]) ? on : base
}
export async function onMainSince(cwd: string, base: string, text: string, branch = "", marks?: Marks | null) {
  const main = await mainOf(cwd)
  if (!main || !base) return false
  const ref = await refOf(cwd, branch)
  if (await namedOnMain(cwd, base, main, text, ref) || await branchOnMain(cwd, base, main, ref)) return true
  if (!marks?.whole && !marks?.each.length) return false
  const on = await mainPatches(cwd, base, main)
  return (!!marks.whole && on.has(marks.whole)) || (!!marks.each.length && marks.each.every((x) => on.has(x)))
}
async function namedOnMain(cwd: string, base: string, main: string, text: string, ref: string) {
  const from = ref ? (await git(cwd, ["merge-base", main, ref])).trim() : ""
  for (const h of commitsIn(text)) {
    if ((from && await gitOk(cwd, ["merge-base", "--is-ancestor", h, from])) || await gitOk(cwd, ["merge-base", "--is-ancestor", h, base])) continue
    if (await gitOk(cwd, ["merge-base", "--is-ancestor", h, main]) || await allOnMain(cwd, main, h)) return true
  }
  return false
}
const branchOnMain = async (cwd: string, base: string, main: string, ref: string) =>
  !!ref && !(await gitOk(cwd, ["merge-base", "--is-ancestor", ref, base])) && (await gitOk(cwd, ["merge-base", "--is-ancestor", ref, main]) || await allOnMain(cwd, main, ref))
async function allOnMain(cwd: string, main: string, commit: string) {
  if (!(await gitOk(cwd, ["cat-file", "-e", `${commit}^{commit}`])) || await gitOk(cwd, ["merge-base", "--is-ancestor", commit, main])) return false
  const [out, from] = await Promise.all([gitAny(cwd, ["merge-tree", "--write-tree", "--name-only", "--no-messages", main, commit]), git(cwd, ["merge-base", main, commit])])
  const [tree, ...rest] = out.split("\n"), conflicted = new Set(rest.filter(Boolean))
  if (!/^[0-9a-f]{40,64}$/.test(tree.trim()) || !from.trim()) return false
  const differ = (await git(cwd, ["diff", "--name-only", "-z", `${main}^{tree}`, tree.trim()])).split("\0").filter(Boolean)
  if (differ.some((f) => !conflicted.has(f))) return false
  for (const f of differ) {
    const [theirs, ours] = await Promise.all([gitOk(cwd, ["cat-file", "-e", `${commit}:${f}`]), gitAny(cwd, ["show", `${main}:${f}`])])
    if (!theirs) return false
    const has = new Set(ours.split("\n").map((l) => l.trim()))
    const added = (await git(cwd, ["diff", "--no-color", "--no-ext-diff", "-U0", from.trim(), commit, "--", f])).split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1).trim())
    if (added.some((l) => l && !has.has(l))) return false
  }
  return true
}
const refOf = async (cwd: string, branch: string) => {
  if (!branch || /^(?:main|master)$/.test(branch)) return ""
  for (const r of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) if (await gitOk(cwd, ["rev-parse", "--verify", "-q", `${r}^{commit}`])) return r
  return ""
}
const fetched = new Map<string, { at: number; done: Promise<void> }>()
export async function fetchMain(cwd: string, branch = "", o: { every?: number; text?: string } = {}) {
  const key = `${cwd}\0${branch}`, f = fetched.get(key)
  const unknown = async () => { for (const h of commitsIn(o.text ?? "")) if (!(await gitOk(cwd, ["cat-file", "-e", `${h}^{commit}`]))) return true; return false }
  if (!f || Date.now() - f.at > (o.every ?? 60_000) || (Date.now() - f.at > 5000 && await unknown())) {
    const main = (await mainOf(cwd)).replace(/^origin\//, "") || "main"
    const own = branch && !/^(?:main|master)$/.test(branch) && !(await gitOk(cwd, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])) ? [`+refs/heads/${branch}:refs/remotes/origin/${branch}`] : []
    // (one refspec its remote lacks fails the whole fetch: a branch not pushed yet)
    const one = (spec: string) => new Promise<void>((ok) => execFile("git", ["-c", "gc.auto=0", "fetch", "-q", "--no-tags", "--no-write-fetch-head", "origin", spec],
      { cwd, timeout: 60_000, env: gitEnv({ GIT_TERMINAL_PROMPT: "0" }) }, () => ok()))
    fetched.set(key, { at: Date.now(), done: Promise.all([`+refs/heads/${main}:refs/remotes/origin/${main}`, ...own].map(one)).then(() => {}) })
    if (fetched.size > 200) fetched.delete(fetched.keys().next().value!)
  }
  await Promise.race([fetched.get(key)!.done, new Promise<void>((ok) => setTimeout(ok, 4000).unref?.())])
}
export async function onMainElsewhere(cwd: string, files: string[], text: string, since: number) {
  const named = commitsIn(text)
  if (!named.length || !since) return false
  const own = await commonOf(cwd), repos = new Set<string>(), dirs = new Set(files.map((f) => path.dirname(f.replace(/^~(?=\/)/, os.homedir()))))
  for (const d of [...dirs].slice(0, 20)) {
    if (!fs.existsSync(d)) continue
    const top = (await git(d, ["rev-parse", "--show-toplevel"])).trim()
    if (top && await commonOf(top) !== own) repos.add(top)
    if (repos.size >= 3) break
  }
  for (const r of repos) {
    await fetchMain(r, "", { text })
    const main = await mainOf(r)
    if (!main) continue
    for (const h of named) {
      const at = Number((await git(r, ["log", "-1", "--format=%ct", `${h}^{commit}`])).trim()) * 1000
      if (at && at >= since - 60_000 && (await gitOk(r, ["merge-base", "--is-ancestor", h, main]) || await allOnMain(r, main, h))) return true
    }
  }
  return false
}
const commonOf = async (dir: string) => path.resolve(dir, (await git(dir, ["rev-parse", "--git-common-dir"])).trim())
const gitAny = (cwd: string, args: string[]) => new Promise<string>((ok) => execFile("git", args, { cwd, timeout: 5000, maxBuffer: 4 << 20, env: gitEnv() }, (_e, out) => ok(String(out ?? ""))))
const gitOk = (cwd: string, args: string[]) => new Promise<boolean>((r) => execFile("git", args, { cwd, timeout: 5000, env: gitEnv() }, (e) => r(!e)))
const mainOf = async (cwd: string) => (await gitOk(cwd, ["rev-parse", "--verify", "-q", "origin/main"])) ? "origin/main" : (await gitOk(cwd, ["rev-parse", "--verify", "-q", "origin/master"])) ? "origin/master" : ""
function patchIds(cwd: string, args: string[]) {
  return new Promise<Map<string, string>>((ok) => {
    const out = new Map<string, string>()
    const a = spawn("git", args, { cwd, env: gitEnv(), stdio: ["ignore", "pipe", "ignore"] }), b = spawn("git", ["patch-id", "--stable"], { cwd, env: gitEnv(), stdio: ["pipe", "pipe", "ignore"] })
    const kill = setTimeout(() => { a.kill(); b.kill() }, 20_000)
    a.stdout.pipe(b.stdin)
    b.stdin.on("error", () => {})
    let text = ""
    b.stdout.on("data", (d) => (text += d))
    b.on("close", () => {
      clearTimeout(kill)
      // (git patch-id names a diff not from git log by an all-zero commit)
      for (const l of text.split("\n")) { const [p, c] = l.trim().split(/\s+/); if (p && c) out.set(/^0+$/.test(c) ? "-" : c, p) }
      ok(out)
    })
    b.on("error", () => { clearTimeout(kill); ok(out) })
  })
}
export async function marksOf(cwd: string, branch: string): Promise<Marks | null> {
  const main = await mainOf(cwd)
  const ref = main ? await refOf(cwd, branch) : ""
  if (!ref) return null
  const own = (await git(cwd, ["rev-list", "--no-merges", "-n", "40", `${main}..${ref}`])).split("\n").filter(Boolean)
  if (!own.length) return null
  const from = (await git(cwd, ["merge-base", main, ref])).trim()
  const [each, whole] = await Promise.all([patchIds(cwd, ["log", "-p", "--no-merges", "--no-color", "--no-ext-diff", "--no-walk=unsorted", ...own]),
    from ? patchIds(cwd, ["diff", "--no-color", "--no-ext-diff", from, ref]) : new Map<string, string>()])
  const m: Marks = { whole: whole.get("-") ?? "", each: own.map((c) => each.get(c) ?? "").filter(Boolean) }
  return m.whole || m.each.length ? m : null
}
const patchOf = new Map<string, string>()
async function mainPatches(cwd: string, base: string, main: string) {
  const since = (await git(cwd, ["rev-list", "--no-merges", "-n", "3000", `${base}..${main}`])).split("\n").filter(Boolean)
  const fresh = since.filter((c) => !patchOf.has(c))
  for (let i = 0; i < fresh.length; i += 200) {
    const got = await patchIds(cwd, ["log", "-p", "--no-merges", "--no-color", "--no-ext-diff", "--no-walk=unsorted", ...fresh.slice(i, i + 200)])
    if (patchOf.size > 50_000) patchOf.clear()
    // (git gives a commit with no diff no patch-id)
    for (const c of fresh.slice(i, i + 200)) patchOf.set(c, got.get(c) ?? "")
  }
  return new Set(since.map((c) => patchOf.get(c)).filter(Boolean))
}
export const marksIn = (v: unknown): Marks | null => {
  if (!v || typeof v !== "object") return null
  const hex = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{40,64}$/.test(x)
  return { whole: "whole" in v && hex(v.whole) ? v.whole : "", each: "each" in v && Array.isArray(v.each) ? v.each.filter(hex).slice(0, 40) : [] }
}
