"use client"

import { motion } from "motion/react"
import { MessageParts } from "@/components/workspace/message-parts"
import { useStreamBuffer } from "@/lib/stream-store"
import { cn } from "@/lib/utils"

const BUBBLE_CLASS =
  "min-w-0 overflow-hidden rounded-xl border border-message-assistant-border bg-message-assistant text-message-assistant-foreground"

export function StreamingBubble({
  streamId,
  animate = false,
  transition,
  presentation = "linear",
}: {
  streamId: string
  /** When true (after-tip rows), fade the bubble in. PathSlot owns its own crossfade. */
  animate?: boolean
  transition?: { duration: number; ease: [number, number, number, number] }
  presentation?: "linear" | "tree"
}) {
  const stream = useStreamBuffer(streamId)
  const parts = stream.parts
  const tree = presentation === "tree"

  const body = (
    <div
      className={
        tree
          ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3.5"
          : "p-4"
      }
      data-tree-scroll={tree ? "" : undefined}
    >
      {tree ? null : (
        <div className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          assistant · streaming
        </div>
      )}
      <MessageParts parts={parts} streaming interactiveTools={false} />
    </div>
  )

  const articleClass = cn(
    BUBBLE_CLASS,
    tree && "flex h-full min-h-0 flex-col"
  )

  if (animate && transition) {
    return (
      <motion.article
        data-theme-group="message-assistant"
        data-theme-target="message-assistant"
        data-tree-streaming={tree ? "" : undefined}
        className={articleClass}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transition}
      >
        {body}
      </motion.article>
    )
  }

  return (
    <article
      data-theme-group="message-assistant"
      data-theme-target="message-assistant"
      data-tree-streaming={tree ? "" : undefined}
      className={articleClass}
    >
      {body}
    </article>
  )
}
