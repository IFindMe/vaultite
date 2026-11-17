import { lazy, Suspense } from "react"
import type { Store } from "@vaultite"
import { preloadList } from "./chunks"

const AllTabsPage = lazy(() => import("./AllTabs"))
const SettingsPanel = lazy(() => import("./Settings"))
const ListLater = lazy(preloadList)

export const AllTabs = ({ store }: { store: Store }) => <Suspense fallback={null}><AllTabsPage store={store} /></Suspense>
export const WorkspaceSettings = () => <Suspense fallback={null}><SettingsPanel /></Suspense>
export const List = (p: { lit: number; over: number | null; focus: boolean; close: () => void }) => <Suspense fallback={null}><ListLater {...p} /></Suspense>
