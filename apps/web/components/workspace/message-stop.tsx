"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { StopIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { useStreamStore } from "@/lib/stream-store"

export function MessageStop({
  streamId,
  captions = false,
}: {
  streamId: string
  captions?: boolean
}) {
  const stream = useStreamStore((state) => state.streams[streamId])
  const stop = useStreamStore((state) => state.stop)
  if (!stream || stream.settled) return null
  const label = stream.stopping ? "Stopping…" : "Stop generation"

  return (
    <Button
      variant="ghost"
      size={captions ? "xs" : "icon-xs"}
      className={captions ? "h-7 gap-1 px-2 text-xs font-normal" : "size-7"}
      aria-label={label}
      data-static-tooltip={captions ? undefined : label}
      data-static-tooltip-gap="4"
      disabled={stream.stopping}
      onClick={() => void stop(streamId)}
    >
      <HugeiconsIcon
        icon={StopIcon}
        strokeWidth={2}
        className="size-3.5"
        aria-hidden
      />
      {captions ? <span className="leading-none">{label}</span> : null}
    </Button>
  )
}
