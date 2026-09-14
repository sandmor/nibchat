"use client"

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown02Icon, ArrowUp02Icon } from "@hugeicons/core-free-icons"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  alignBlockInScrollport,
  blockEdgeVisibility,
  isBlockOverflowing,
  navMeasureTarget,
  nearestScrollport,
} from "./long-block-scroll"

export function useBlockOverflow(blockRef: RefObject<HTMLElement | null>) {
  const [overflowing, setOverflowing] = useState(false)
  const [startVisible, setStartVisible] = useState(true)
  const [endVisible, setEndVisible] = useState(true)
  const [nestedScroll, setNestedScroll] = useState(false)

  useEffect(() => {
    const block = blockRef.current
    if (!block) return
    const port = nearestScrollport(block)
    if (!port) return
    setNestedScroll(port.hasAttribute("data-tree-scroll"))

    const measure = () => {
      const target = navMeasureTarget(block)
      const blockRect = target.getBoundingClientRect()
      const portRect = port.getBoundingClientRect()
      const nextOverflowing = isBlockOverflowing(
        blockRect.height,
        port.clientHeight
      )
      const edges = blockEdgeVisibility(blockRect, portRect)
      setOverflowing((current) =>
        current === nextOverflowing ? current : nextOverflowing
      )
      setStartVisible((current) =>
        current === edges.startVisible ? current : edges.startVisible
      )
      setEndVisible((current) =>
        current === edges.endVisible ? current : edges.endVisible
      )
    }

    measure()
    const resize = new ResizeObserver(measure)
    resize.observe(block)
    resize.observe(port)
    port.addEventListener("scroll", measure, { passive: true })
    return () => {
      resize.disconnect()
      port.removeEventListener("scroll", measure)
    }
  }, [blockRef])

  return { overflowing, startVisible, endVisible, nestedScroll }
}

export function LongBlockFrame({
  children,
  className,
  style,
  label = "message",
  tone = "assistant",
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  label?: string
  tone?: "user" | "assistant"
}) {
  const blockRef = useRef<HTMLDivElement>(null)
  const overflow = useBlockOverflow(blockRef)
  return (
    <div
      ref={blockRef}
      className={cn(
        "relative min-w-0",
        // Either sticky tab can reach the opposite corner while scrolling.
        overflow.overflowing &&
          "[&>article]:rounded-se-none [&>article]:rounded-ee-none",
        className
      )}
      style={style}
    >
      {children}
      <LongBlockNav
        blockRef={blockRef}
        label={label}
        overflowing={overflow.overflowing}
        startVisible={overflow.startVisible}
        endVisible={overflow.endVisible}
        tone={tone}
      />
    </div>
  )
}

function LongBlockNav({
  blockRef,
  label,
  overflowing,
  startVisible,
  endVisible,
  tone,
}: {
  blockRef: RefObject<HTMLElement | null>
  label: string
  overflowing: boolean
  startVisible: boolean
  endVisible: boolean
  tone: "user" | "assistant"
}) {
  if (!overflowing) return null

  const tabClass =
    tone === "user"
      ? "border-y border-e border-message-user-border bg-message-user"
      : "border-y border-e border-message-assistant-border bg-message-assistant"

  return (
    <div
      data-find-skip
      className="pointer-events-none absolute inset-y-0 end-0 z-10 flex w-0 flex-col justify-between overflow-visible"
    >
      <div
        className={cn(
          "pointer-events-auto sticky top-0",
          startVisible && "invisible"
        )}
      >
        <BookmarkTab
          edge="end"
          radius="xl"
          testId="long-block-nav-start"
          label={`Jump to start of ${label}`}
          icon={ArrowUp02Icon}
          disabled={startVisible}
          className={tabClass}
          onClick={() => {
            const target = blockRef.current
            if (target)
              alignBlockInScrollport(navMeasureTarget(target), "start")
          }}
        />
      </div>
      <div
        className={cn(
          "pointer-events-auto sticky bottom-0",
          endVisible && "invisible"
        )}
      >
        <BookmarkTab
          edge="end"
          radius="xl"
          testId="long-block-nav-end"
          label={`Jump to end of ${label}`}
          icon={ArrowDown02Icon}
          disabled={endVisible}
          className={tabClass}
          onClick={() => {
            const target = blockRef.current
            if (target) alignBlockInScrollport(navMeasureTarget(target), "end")
          }}
        />
      </div>
    </div>
  )
}

export function BookmarkTab({
  edge,
  radius,
  testId,
  label,
  icon,
  disabled,
  className,
  onClick,
}: {
  edge: "start" | "end"
  radius: "lg" | "xl"
  testId?: string
  label: string
  icon: typeof ArrowUp02Icon
  disabled?: boolean
  className?: string
  onClick: () => void
}) {
  const start = edge === "start"
  return (
    <TooltipProvider delay={400}>
      <WithTooltip label={label}>
        <button
          type="button"
          data-testid={testId}
          aria-label={label}
          disabled={disabled}
          className={cn(
            "flex h-10 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:[&>svg]:opacity-40",
            // Overlap only the attachment seam, leaving the tab outside the block.
            start
              ? "-translate-x-[calc(100%-1px)] rtl:translate-x-[calc(100%-1px)]"
              : "-translate-x-px rtl:translate-x-px",
            radius === "xl"
              ? start
                ? "rounded-s-xl"
                : "rounded-e-xl"
              : start
                ? "rounded-s-lg"
                : "rounded-e-lg",
            className
          )}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClick()
          }}
        >
          <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
        </button>
      </WithTooltip>
    </TooltipProvider>
  )
}
