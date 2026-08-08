"use client"

import { motion } from "motion/react"
import { MessageParts } from "@/components/workspace/message-parts"
import type { ActiveStream } from "@/lib/stream-store"
import type { Parts } from "@/lib/types"

export function StreamingBubble({
  stream,
  animate = false,
  transition,
}: {
  stream: ActiveStream
  /** When true (after-tip rows), fade the bubble in. PathSlot owns its own crossfade. */
  animate?: boolean
  transition?: { duration: number; ease: [number, number, number, number] }
}) {
  const parts: Parts = [
    ...(stream.reasoning
      ? [{ type: "reasoning" as const, text: stream.reasoning }]
      : []),
    ...stream.tools,
    ...(stream.text ? [{ type: "text" as const, text: stream.text }] : []),
  ]

  const body = (
    <>
      <div className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        assistant · streaming
      </div>
      <MessageParts
        parts={parts}
        role="assistant"
        streamingPlaceholder
        interactiveTools={false}
      />
    </>
  )

  if (animate && transition) {
    return (
      <motion.article
        className="min-w-0 overflow-hidden rounded-xl border bg-card p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transition}
      >
        {body}
      </motion.article>
    )
  }

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border bg-card p-4">
      {body}
    </article>
  )
}
