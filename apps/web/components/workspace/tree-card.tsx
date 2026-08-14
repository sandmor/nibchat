"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon } from "@hugeicons/core-free-icons"
import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import type { TreeRect } from "./tree-layout"

type Motion = { duration: number; ease: [number, number, number, number] }

/**
 * Canvas cards have two identities, never one component that tries to be both:
 *
 * 1. ComposeSlot — the synthetic plus. Its outer shell owns geometry while
 *    AnimatePresence keeps the outgoing face mounted for the crossfade.
 * 2. TreeHandoff — a one-shot overlay created at send. First paint is the
 *    frozen composer box with the composer fully visible; the next frame
 *    updates geometry and opacities so Motion plays a crossfade + morph.
 *
 * Motion `layoutId` is not used: the tree's camera transform and measured
 * layout are already their own coordinate system. Geometry is explicit and
 * the content transition stays local to that geometry shell.
 */

export function ComposeSlot({
  id,
  open,
  rect,
  animate,
  transition,
  plusDisabled,
  plusLabel,
  onPlus,
  composer,
}: {
  id: string
  open: boolean
  rect: TreeRect
  animate: boolean
  transition: Motion
  plusDisabled?: boolean
  plusLabel: string
  onPlus: () => void
  composer: ReactNode
}) {
  const motionTransition = animate ? transition : { duration: 0 }

  return (
    <motion.div
      data-tree-compose-slot={id}
      className="absolute overflow-hidden rounded-xl"
      initial={false}
      animate={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
      transition={motionTransition}
    >
      <AnimatePresence initial={false} mode="sync">
        {open ? (
          <motion.div
            key="composer"
            className="absolute inset-x-0 top-0"
            data-tree-chrome
            data-tree-size={id}
            style={{ width: rect.width }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransition}
          >
            {composer}
          </motion.div>
        ) : (
          <motion.div
            key="plus"
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTransition}
          >
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-full rounded-2xl border-dashed"
              disabled={plusDisabled}
              aria-label={plusLabel}
              onClick={onPlus}
            >
              <HugeiconsIcon icon={Add01Icon} className="size-5" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function TreeHandoff({
  fromRect,
  toRect,
  animate,
  transition,
  composer,
  message,
  hitId,
  onComplete,
}: {
  fromRect: TreeRect
  toRect: TreeRect
  animate: boolean
  transition: Motion
  composer: ReactNode
  message: ReactNode
  hitId: string
  onComplete: () => void
}) {
  const motionTransition = animate ? transition : { duration: 0 }
  const [live, setLive] = useState(false)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const finish = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    onCompleteRef.current()
  }, [])

  useEffect(() => {
    // Interaction effects may run before paint. Two frames guarantee the
    // frozen composer is visible once before Motion receives its target.
    let secondFrame = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setLive(true))
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [])

  useEffect(() => {
    if (!live) return
    const ms = animate ? Math.ceil(transition.duration * 1000) + 32 : 0
    const timer = window.setTimeout(finish, ms)
    return () => window.clearTimeout(timer)
  }, [live, animate, transition.duration, finish])

  const rect = live ? toRect : fromRect

  return (
    <motion.div
      data-tree-handoff={hitId}
      className="absolute z-10 overflow-hidden rounded-xl"
      initial={false}
      animate={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
      transition={motionTransition}
      onAnimationComplete={() => {
        if (!live) return
        finish()
      }}
    >
      <motion.div
        className="absolute inset-x-0 top-0"
        aria-hidden={live}
        inert={live ? true : undefined}
        initial={false}
        animate={{ opacity: live ? 0 : 1 }}
        transition={motionTransition}
        style={{ pointerEvents: "none" }}
      >
        {composer}
      </motion.div>
      <motion.div
        className="absolute inset-0 overflow-auto overscroll-contain [touch-action:pan-x_pan-y] select-text"
        data-tree-hit={hitId}
        data-tree-scroll=""
        aria-hidden={!live}
        inert={live ? undefined : true}
        initial={false}
        animate={{ opacity: live ? 1 : 0 }}
        transition={motionTransition}
        style={{ pointerEvents: live ? "auto" : "none" }}
      >
        {message}
      </motion.div>
    </motion.div>
  )
}
