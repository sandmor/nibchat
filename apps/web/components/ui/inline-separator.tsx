import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Hairline between peer items in a row. Decorative; the words carry the meaning. */
export function InlineSeparator({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("h-3 w-px shrink-0 bg-border", className)}
    />
  )
}

export function MetaLine({
  items,
  className,
}: {
  items: Array<ReactNode | null | undefined | false | "">
  className?: string
}) {
  const visible = items.filter(
    (item): item is ReactNode => item != null && item !== false && item !== ""
  )
  if (visible.length === 0) return null
  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-x-1.5 align-middle",
        className
      )}
    >
      {visible.map((item, index) => (
        <span
          key={index}
          className="inline-flex min-w-0 items-center gap-x-1.5"
        >
          {index > 0 ? <InlineSeparator /> : null}
          <span className="min-w-0">{item}</span>
        </span>
      ))}
    </span>
  )
}
