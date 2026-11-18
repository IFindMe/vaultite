import { useMemo, type ReactNode } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/Button"
import { Bar } from "@/components/kit"
import { useOffline } from "@/core/connection"
import { errorText } from "@/core/notify"
import type { Reading } from "@/core/reading"
import { cn } from "@/lib/utils"
import { plainError } from "../../../core/plainerror.ts"

const LINE = "text-[17px] leading-[24px] text-muted-foreground md:text-[15px] md:leading-[22px]"

function TryAgain({ read }: { read: Reading<unknown> }) {
  return <Button size="small" className="mt-3" onClick={read.retry}><RotateCcw className="size-3.5" strokeWidth={2} />Try again</Button>
}

export function ReadFailed({ read, what, className }: { read: Reading<unknown>; what: string; className?: string }) {
  const text = useMemo(() => errorText(read.error, what), [read.error, what])
  return (
    <div role="alert" data-read-failed className={className}>
      <p className={cn(LINE, "select-text")}>{text}{plainError(read.error).network && " Trying again once the connection's back."}</p>
      <TryAgain read={read} />
    </div>
  )
}

export function ReadSlow({ read, className }: { read: Reading<unknown>; className?: string }) {
  const offline = useOffline()
  if (!read.slow) return null
  return (
    <div role="status" data-read-slow className={cn("loading-in", className)}>
      <p className={LINE}>{offline ? "Waiting for the connection…" : "Still loading…"}</p>
      <TryAgain read={read} />
    </div>
  )
}

export function Pending({ read, what, className, children }: { read: Reading<unknown>; what: string; className?: string; children: ReactNode }) {
  if (read.error !== undefined) return <ReadFailed read={read} what={what} className={className} />
  return (
    <div aria-busy className={className} data-pending>
      <div className="loading-in" aria-hidden>{children}</div>
      <ReadSlow read={read} className="mt-6" />
    </div>
  )
}

const widths = ["92%", "97%", "84%", "64%", "95%", "88%", "41%"]
export function TextLines({ lines = 7 }: { lines?: number }) {
  return (
    <div className="note-prose">
      {Array.from({ length: lines }, (_, i) => (
        <p key={i} className={cn(i === 3 && "mt-[26px]")}><Bar w={widths[i % widths.length]} /></p>
      ))}
    </div>
  )
}
