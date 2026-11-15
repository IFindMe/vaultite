import type { CSSProperties } from "react"
let edging = false
export const edgeTouch = () => edging
export const setEdgeTouch = (on: boolean) => { edging = on }
export const SIDEWAYS_TO_DRAWERS = { touchAction: "pan-y pinch-zoom" } satisfies CSSProperties
