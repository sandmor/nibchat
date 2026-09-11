import Link from "next/link"
import type { ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { SquareLock01Icon } from "@hugeicons/core-free-icons"
import { buttonVariants } from "@/components/ui/button"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { SpaceLockSource } from "@/lib/space"

export function SpaceLockHint({ lock }: { lock?: SpaceLockSource }) {
  if (!lock) return null
  return (
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <HugeiconsIcon
        icon={SquareLock01Icon}
        strokeWidth={2}
        className="size-3 shrink-0"
        aria-hidden
      />
      <span>
        From{" "}
        <Link
          href={`/space/${lock.spaceId}`}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {lock.spaceName}
        </Link>
      </span>
    </p>
  )
}

/** Header control for a locked slot: the value links to the space. */
export function LockedPickerTrigger({
  lock,
  label,
  className,
  children,
}: {
  lock: SpaceLockSource
  label: string
  className?: string
  children?: ReactNode
}) {
  return (
    <TooltipProvider delay={400}>
      <WithTooltip label={`Locked by ${lock.spaceName}`}>
        <Link
          href={`/space/${lock.spaceId}`}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "max-w-[min(10rem,28vw)] min-w-0 px-2",
            className
          )}
          aria-label={`${label}, locked by ${lock.spaceName}`}
        >
          <HugeiconsIcon
            icon={SquareLock01Icon}
            strokeWidth={2}
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          {children ?? <span className="truncate">{label}</span>}
        </Link>
      </WithTooltip>
    </TooltipProvider>
  )
}
