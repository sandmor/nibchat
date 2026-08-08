"use client"

import type { ReactNode } from "react"
import { AnimatePresence, motion, useIsPresent } from "motion/react"
import { cn } from "@/lib/utils"

export type SlotMotion = {
  duration: number
  ease: [number, number, number, number]
}

/**
 * Crossfade between successive contents of one path depth slot.
 *
 * The slot shell (MessageScrollerItem) stays mounted; only the keyed layer
 * changes. Layout (absolute exit stacking) is applied via style so Motion
 * never tweens non-animatable `position`/`inset` from "auto". Exit layers are
 * inert to pointer and AT — present layer is the only interactive body.
 */
export function SlotCrossfade({
  contentKey,
  animate,
  transition,
  className,
  children,
}: {
  /** Stable identity for this paint (node id, stream id, …). */
  contentKey: string
  animate: boolean
  transition: SlotMotion
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <AnimatePresence mode="sync" initial={false}>
        <SlotCrossfadeLayer
          key={contentKey}
          animate={animate}
          transition={transition}
        >
          {children}
        </SlotCrossfadeLayer>
      </AnimatePresence>
    </div>
  )
}

function SlotCrossfadeLayer({
  children,
  animate,
  transition,
}: {
  children: ReactNode
  animate: boolean
  transition: SlotMotion
}) {
  const isPresent = useIsPresent()

  return (
    <motion.div
      className="w-full min-w-0"
      data-slot-layer={isPresent ? "present" : "exit"}
      aria-hidden={isPresent ? undefined : true}
      style={
        isPresent
          ? undefined
          : {
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }
      }
      initial={animate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={animate ? { opacity: 0 } : undefined}
      transition={transition}
    >
      {children}
    </motion.div>
  )
}
