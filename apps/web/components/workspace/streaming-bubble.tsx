"use client"

import { motion } from "motion/react"
import { MessageParts } from "@/components/workspace/message-parts"
import { useStreamBuffer } from "@/lib/stream-store"
import type { Parts } from "@/lib/types"

const BUBBLE_CLASS =
  "min-w-0 overflow-hidden rounded-xl border border-message-assistant-border bg-message-assistant p-4 text-message-assistant-foreground"

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
  const parts: Parts = [
    ...(stream.reasoning
      ? [{ type: "reasoning" as const, text: stream.reasoning }]
      : []),
    ...stream.tools,
    ...(stream.text ? [{ type: "text" as const, text: stream.text }] : []),
  ]
  const tree = presentation === "tree"

  const body = (
    <>
      {tree ? null : (
        <div className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          assistant · streaming
        </div>
      )}
      <MessageParts parts={parts} streaming interactiveTools={false} />
    </>
  )

  if (animate && transition) {
    return (
      <motion.article
        data-theme-group="message-assistant"
        data-theme-target="message-assistant"
        data-tree-streaming={tree ? "" : undefined}
        className={BUBBLE_CLASS}
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
      className={BUBBLE_CLASS}
    >
      {body}
    </article>
  )
}
