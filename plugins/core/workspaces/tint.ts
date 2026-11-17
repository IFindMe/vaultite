import type { CSSProperties } from "react"
import { colorVar } from "@vaultite"

export const tintWash = (tint: string | undefined, on: boolean): CSSProperties | undefined => {
  if (!tint) return undefined
  const c = `color-mix(in oklab, ${colorVar(tint)} ${on ? 22 : 10}%, transparent)`
  return { backgroundImage: `linear-gradient(${c}, ${c})` }
}
