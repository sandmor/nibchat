"use client"

/**
 * One depth slot on the active path.
 *
 * React list key is path depth (`row.reactKey` = `slot:N`). MessageScroller
 * `messageId` tracks the bound node/stream for scroll. Sibling branch switches
 * rebind content under a stable shell; {@link SlotCrossfade} owns enter/exit
 * motion so Message stays a single present body.
 */
import { MessageScrollerItem } from "@/components/ui/message-scroller"
import type { NodeRow } from "@/lib/types"
import type { ProviderSummary } from "./types"
import { Message } from "./message"
import { StreamingBubble } from "./streaming-bubble"
import { SlotCrossfade } from "./slot-crossfade"
import {
  LIVE_ROW_CLASS,
  type PathTranscriptRow,
} from "./chat-transcript-helpers"

export function PathSlot({
  row,
  nodes,
  providers,
  animate,
  transition,
  messageActionCaptions,
  onSelect,
  onChanged,
  onRegenerate,
  onGenerateUnder,
  onAnswerTools,
}: {
  row: PathTranscriptRow
  nodes: NodeRow[]
  providers: ProviderSummary[]
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
  messageActionCaptions: boolean
  onSelect: (parentId: string, childId: string) => void
  onChanged: () => void | Promise<void>
  onRegenerate: (assistantNodeId: string) => void
  onGenerateUnder: (parentNodeId: string) => void | Promise<void>
  onAnswerTools?: (
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) => void | Promise<void>
}) {
  const liveStreamId = row.liveStreamId
  const contentKey = liveStreamId
    ? `stream:${liveStreamId}`
    : `node:${row.node.id}`

  return (
    <MessageScrollerItem
      messageId={row.messageId}
      scrollAnchor={row.scrollAnchor}
      className={liveStreamId ? LIVE_ROW_CLASS : undefined}
    >
      <SlotCrossfade
        contentKey={contentKey}
        animate={animate}
        transition={transition}
      >
        {liveStreamId ? (
          <StreamingBubble streamId={liveStreamId} />
        ) : (
          <Message
            node={row.node}
            nodes={nodes}
            providers={providers}
            messageActionCaptions={messageActionCaptions}
            onSelect={onSelect}
            onChanged={onChanged}
            onRegenerate={
              row.node.role === "assistant"
                ? () => onRegenerate(row.node.id)
                : undefined
            }
            onGenerateUnder={onGenerateUnder}
            onAnswerTools={onAnswerTools}
          />
        )}
      </SlotCrossfade>
    </MessageScrollerItem>
  )
}
