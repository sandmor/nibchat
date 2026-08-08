"use client"

/**
 * One depth slot on the active path.
 *
 * React key is path slot depth (`row.reactKey` = `slot:N`). MessageScroller
 * `messageId` is the node id. Sibling branch switches rebind the node in the
 * same slot so Message can crossfade by node.id without remounting the shell.
 */
import { MessageScrollerItem } from "@/components/ui/message-scroller"
import type { NodeRow } from "@/lib/types"
import type { ProviderSummary } from "./types"
import { Message } from "./message"
import { StreamingBubble } from "./streaming-bubble"
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
}) {
  const live = row.live

  return (
    <MessageScrollerItem
      messageId={row.messageId}
      scrollAnchor={row.scrollAnchor}
      className={live ? LIVE_ROW_CLASS : undefined}
    >
      {live ? (
        <StreamingBubble
          streamId={live[0]}
          stream={live[1]}
          animate={animate}
          transition={transition}
        />
      ) : (
        <Message
          node={row.node}
          nodes={nodes}
          providers={providers}
          animate={animate}
          transition={transition}
          messageActionCaptions={messageActionCaptions}
          onSelect={onSelect}
          onChanged={onChanged}
          onRegenerate={
            row.node.role === "assistant"
              ? () => onRegenerate(row.node.id)
              : undefined
          }
          onGenerateUnder={onGenerateUnder}
        />
      )}
    </MessageScrollerItem>
  )
}
