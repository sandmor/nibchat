import type { Metadata } from "next"
import { requireWorkspaceUser } from "@/lib/app-session"
import { getWorkspace } from "@/lib/chat-service"
import { ChatView } from "@/components/workspace/chat-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "New conversation",
}

export default async function NewChatPage({
  searchParams,
}: {
  searchParams: Promise<{ space?: string }>
}) {
  const user = await requireWorkspaceUser()
  const workspace = await getWorkspace(user.id, { draft: true })
  const { space } = await searchParams
  const draftSpaceId =
    space && workspace.spaces.some((row) => row.id === space) ? space : null

  return (
    <ChatView
      mode="draft"
      chatId={null}
      initial={workspace}
      draftSpaceId={draftSpaceId}
    />
  )
}
