"use client"

/**
 * One depth slot on the active path.
 *
 * The enclosing virtual row is keyed by path depth. Sibling branch switches
 * rebind content under that stable shell; {@link SlotCrossfade} owns enter/exit
 * motion so Message stays a single present body.
 */
import type { NodeRow } from "@/lib/types"
import type { ProviderSummary } from "./types"
import { Message, type MessageComposerBindings } from "./message"
import { StreamingBubble } from "./streaming-bubble"
import { SlotCrossfade } from "./slot-crossfade"
import {
  transcriptRowContentKey,
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
  onAnswerTools,
  composer,
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
  onAnswerTools?: (
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) => void | Promise<void>
  composer?: MessageComposerBindings
}) {
  const liveStreamId = row.liveStreamId

  return (
    <SlotCrossfade
      contentKey={transcriptRowContentKey(row)}
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
          onAnswerTools={onAnswerTools}
          composer={composer}
        />
      )}
    </SlotCrossfade>
  )
}
