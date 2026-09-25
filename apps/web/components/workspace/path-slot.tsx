"use client"

/**
 * One depth slot on the active path.
 *
 * The enclosing virtual row is keyed by path depth. Sibling branch switches
 * rebind content under that stable shell; {@link SlotCrossfade} owns enter/exit
 * motion so Message stays a single present body.
 */
import { useCallback } from "react"
import type { NodeRow } from "@/lib/types"
import type { ProviderSummary } from "./types"
import { Message, type MessageEditorBindings } from "./message"
import { SlotCrossfade } from "./slot-crossfade"
import {
  transcriptRowContentKey,
  type PathTranscriptRow,
} from "./chat-transcript-helpers"

export function PathSlot({
  row,
  nodes,
  siblingNodes,
  providers,
  animate,
  transition,
  messageActionCaptions,
  onSelect,
  onChanged,
  onGenerateReplies,
  onAnswerTools,
  editor,
}: {
  row: PathTranscriptRow
  nodes: NodeRow[]
  siblingNodes?: readonly NodeRow[]
  providers: ProviderSummary[]
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
  messageActionCaptions: boolean
  onSelect: (parentId: string, childId: string) => void
  onChanged: () => void | Promise<void>
  onGenerateReplies: (nodeId: string | null, count?: number) => void
  onAnswerTools?: (
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) => void | Promise<void>
  editor?: MessageEditorBindings
}) {
  const nodeId = row.node.id
  const parentId = row.node.parent_id
  const handleGenerateReplies = useCallback(
    (count?: number) => onGenerateReplies(nodeId, count),
    [nodeId, onGenerateReplies]
  )
  const handleRegenerate = useCallback(
    (count?: number) => onGenerateReplies(parentId, count),
    [onGenerateReplies, parentId]
  )

  return (
    <SlotCrossfade
      contentKey={transcriptRowContentKey(row)}
      animate={animate}
      transition={transition}
    >
      <Message
        node={row.node}
        nodes={nodes}
        siblingNodes={siblingNodes}
        providers={providers}
        messageActionCaptions={messageActionCaptions}
        onSelect={onSelect}
        onChanged={onChanged}
        onGenerateReplies={handleGenerateReplies}
        onRegenerate={handleRegenerate}
        onAnswerTools={onAnswerTools}
        editor={editor}
        streamId={row.liveStreamId}
      />
    </SlotCrossfade>
  )
}
