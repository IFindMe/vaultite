import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import zlib from "node:zlib"
import { contentType } from "./filetypes.ts"

export type Encoding = "br" | "gzip"
export const ENCODINGS: readonly Encoding[] = ["br", "gzip"]
const EXTENSION: Record<Encoding, string> = { br: ".br", gzip: ".gz" }
export const COPY = /\.(br|gz)$/
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json|wasm)|image\/svg)/
const SMALLEST = 1024

export const compressibleType = (type: string) => COMPRESSIBLE.test(type)
export const worthCompressing = (type: string, size: number) => size >= SMALLEST && compressibleType(type)
export const copyOf = (file: string, enc: Encoding) => file + EXTENSION[enc]

const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip)
export function compress(data: Buffer, enc: Encoding, effort: "smallest" | "quick") {
  const best = effort === "smallest"
  if (enc === "gzip") return gzip(data, { level: best ? 9 : 6 })
  return brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: best ? 11 : 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
}

const tmpOf = (file: string) => `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`

export async function writeWhole(file: string, data: Buffer) {
  const tmp = tmpOf(file)
  try {
    await fs.promises.writeFile(tmp, data)
    await fs.promises.rename(tmp, file)
  } catch (e) {
    await fs.promises.rm(tmp, { force: true })
    throw e
  }
}

/** A copy already there, or in `cache` (earlier builds'), is taken as it is: a file's name is its content's hash. */
export async function precompress(files: string[], cache = "", jobs = Math.min(4, os.availableParallelism())) {
  const todo = files.filter((f) => compressibleType(contentType(f))).flatMap((f) => ENCODINGS.map((enc): [string, Encoding] => [f, enc]))
  let made = 0
  if (cache && !(await fs.promises.mkdir(cache, { recursive: true }).then(() => true, () => false))) cache = ""
  const work = async () => {
    for (let next; (next = todo.shift());) {
      const [file, enc] = next, to = copyOf(file, enc), cached = cache && path.join(cache, path.basename(to))
      if (fs.existsSync(to) || (cached && await cloneWhole(cached, to))) continue
      const data = await fs.promises.readFile(file)
      if (data.length < SMALLEST) continue
      const copy = await compress(data, enc, "smallest")
      await writeWhole(to, copy)
      if (cached) await writeWhole(cached, copy).catch(() => null)
      made++
    }
  }
  await Promise.all(Array.from({ length: jobs }, work))
  return made
}

async function cloneWhole(from: string, to: string) {
  const tmp = tmpOf(to)
  try {
    await fs.promises.copyFile(from, tmp, fs.constants.COPYFILE_FICLONE)
    await fs.promises.rename(tmp, to)
    const now = new Date()
    await fs.promises.utimes(from, now, now)
    return true
  } catch {
    await fs.promises.rm(tmp, { force: true })
    return false
  }
}

export async function pruneCache(cache: string, unusedDays = 14) {
  const oldest = Date.now() - unusedDays * 86_400_000
  for (const n of await fs.promises.readdir(cache).catch(() => [])) {
    const f = path.join(cache, n), st = await fs.promises.stat(f).catch(() => null)
    if (st && st.mtimeMs < oldest) await fs.promises.rm(f, { force: true })
  }
}
