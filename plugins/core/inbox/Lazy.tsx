import { lazy, Suspense } from "react"

const Session = lazy(() => import("./Session").then((m) => ({ default: m.SessionSheet })))
const Elsewhere = lazy(() => import("./Elsewhere").then((m) => ({ default: m.ElsewhereSheet })))

export const LazySessionSheet = ({ id }: { id: string }) => <Suspense fallback={null}><Session id={id} /></Suspense>
export const LazyElsewhereSheet = ({ id }: { id: string }) => <Suspense fallback={null}><Elsewhere id={id} /></Suspense>
