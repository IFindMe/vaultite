import { lazy, Suspense } from "react"
import type { Store } from "@vaultite"

const AllTabsPage = lazy(() => import("./AllTabs"))
const SettingsPanel = lazy(() => import("./Settings"))

export const AllTabs = ({ store }: { store: Store }) => <Suspense fallback={null}><AllTabsPage store={store} /></Suspense>
export const WorkspaceSettings = () => <Suspense fallback={null}><SettingsPanel /></Suspense>
