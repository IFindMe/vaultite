import { useLayoutEffect, type RefObject } from "react"
import { createPortal } from "react-dom"
import { CornerDownLeft, Undo2, type LucideIcon } from "lucide-react"
import { KeyBar, useVisibleArea } from "@/components/KeyBar"

const remeasureKeyboardForToasts = () => visualViewport?.dispatchEvent(new Event("resize"))

export default function TitleKeys({ field, back, next }: { field: RefObject<HTMLTextAreaElement | null>; back?: () => void; next: (t: HTMLTextAreaElement) => void }) {
  const area = useVisibleArea(true)
  useLayoutEffect(() => { if (area?.keyboard) remeasureKeyboardForToasts() }, [area?.keyboard])
  const t = field.current
  if (!t || !area?.keyboard) return null
  const key = (Icon: LucideIcon, text: string) => <span className="flex items-center gap-1.5 font-sans text-[14px]"><Icon className="size-[17px]" strokeWidth={2} />{text}</span>
  return createPortal(
    <div className="fixed inset-x-0 z-[45] -translate-y-full" style={{ top: area.top + area.height }} data-title-keys>
      <KeyBar label="Name keys" hide={() => t.blur()} keys={[
        ...(back ? [{ name: "Put the name back", label: key(Undo2, "Put back"), run: back }] : []),
        { name: "Go to the text", label: key(CornerDownLeft, "Go to the text"), run: () => next(t) },
      ]} />
    </div>,
    t.closest<HTMLElement>("dialog[open]") ?? document.body,
  )
}
