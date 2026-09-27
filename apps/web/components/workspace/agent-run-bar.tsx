"use client"

import Link from "next/link"
import { InlineSeparator } from "@/components/ui/inline-separator"
import type { ChatRow } from "@/lib/types"

export function helperRunLabel(chat: ChatRow) {
  try {
    const snapshot = JSON.parse(chat.agent_config_json ?? "{}") as {
      name?: unknown
    }
    if (typeof snapshot.name === "string" && snapshot.name.trim())
      return snapshot.name.trim()
  } catch {
    // A damaged snapshot still needs a readable label.
  }
  return "Helper"
}

export function parentChatHref(chat: ChatRow) {
  if (!chat.parent_chat_id) return null
  return chat.parent_node_id
    ? `/chat/${chat.parent_chat_id}?node=${chat.parent_node_id}`
    : `/chat/${chat.parent_chat_id}`
}

export function AgentRunSubtitle({ chat }: { chat: ChatRow }) {
  const parentHref = parentChatHref(chat)
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">{helperRunLabel(chat)}</span>
      {parentHref ? (
        <>
          <InlineSeparator />
          <Link
            href={parentHref}
            className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
          >
            Back to parent
          </Link>
        </>
      ) : null}
    </p>
  )
}
