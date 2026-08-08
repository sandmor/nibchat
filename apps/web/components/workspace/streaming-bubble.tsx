"use client"

import { motion } from "motion/react"
import { Markdown } from "@/components/markdown"
import type { ActiveStream } from "@/lib/stream-store"

export function StreamingBubble({
  streamId,
  stream,
  animate,
  transition,
}: {
  streamId: string
  stream: ActiveStream
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
}) {
  return (
    <motion.article
      key={streamId}
      className="min-w-0 overflow-hidden rounded-xl border bg-card p-4"
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
    >
      <div className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        assistant · streaming
      </div>
      {stream.reasoning && (
        <details className="mb-3 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Reasoning</summary>
          <p className="mt-2 whitespace-pre-wrap">{stream.reasoning}</p>
        </details>
      )}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <Markdown>{stream.text || "Thinking…"}</Markdown>
      </div>
    </motion.article>
  )
}
