"use client"

/**
 * One depth slot on the active path.
 *
 * The enclosing virtual row is keyed by path depth. Sibling branch switches
 * rebind the message in place; the body crossfade owns enter/exit motion so
 * the article shell and footer stay mounted.
 */
import { useCallback } from "react"
import type { NodeRow } from "@/lib/types"
import type { ProviderSummary } from "./types"
import { Message, type MessageEditorBindings } from "./message"
import type { SlotMotion } from "./slot-crossfade"
import type { PathTranscriptRow } from "./chat-transcript-helpers"

export function PathSlot({
  row,
  nodes,
  siblingNodes,
  providers,
  animate,
  transition,
  messageActionCaptions,
  slotKey,
  registerStepper,
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
  transition: SlotMotion
  messageActionCaptions: boolean
  slotKey: string
  registerStepper: (key: string, element: HTMLElement | null) => void
  onSelect: (
    slotKey: string,
    parentId: string,
    childId: string
  ) => Promise<void>
  onChanged: () => void | Promise<void>
  onGenerateReplies: (nodeId: string | null, count?: number) => void
  onAnswerTools?: (
    assistantNodeId: string,
    toolResults: Array<{ toolCallId: string; output: unknown }>
  ) => void | Promise<void>
  editor?: MessageEditorBindings
}) {
  const stepperRef = useCallback(
    (element: HTMLSpanElement | null) => registerStepper(slotKey, element),
    [registerStepper, slotKey]
  )
  const selectVersion = useCallback(
    (parentId: string, childId: string) => {
      void onSelect(slotKey, parentId, childId)
    },
    [onSelect, slotKey]
  )
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
    <Message
      node={row.node}
      nodes={nodes}
      siblingNodes={siblingNodes}
      providers={providers}
      messageActionCaptions={messageActionCaptions}
      animate={animate}
      transition={transition}
      onSelect={selectVersion}
      stepperRef={stepperRef}
      onChanged={onChanged}
      onGenerateReplies={handleGenerateReplies}
      onRegenerate={handleRegenerate}
      onAnswerTools={onAnswerTools}
      editor={editor}
      streamId={row.liveStreamId}
    />
  )
}
