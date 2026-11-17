export type Moves = { seq: number; log: { seq: number; from: number; to: number }[] }
export const NO_MOVES: Moves = { seq: 0, log: [] }

export function afterMove({ from, to }: { from: number; to: number }, n: number): number {
  if (n === from) return to
  if (from < to && n > from && n <= to) return n - 1
  if (from > to && n >= to && n < from) return n + 1
  return n
}

export function numberNow(moves: Moves, n: number, seen: number): number | null {
  if (seen >= moves.seq) return n
  const since = moves.log.filter((m) => m.seq > seen)
  if (since.length !== moves.seq - seen) return null
  return since.reduce((at, m) => afterMove(m, at), n)
}

export function moved<T>(list: T[], from: number, to: number): T[] {
  const out = [...list], [d] = out.splice(from - 1, 1)
  out.splice(to - 1, 0, d)
  return out
}
