import type { Metadata } from "next"
import { requireWorkspaceUser } from "@/lib/app-session"
import { getWorkspace } from "@/lib/chat-service"
import { ChatView } from "@/components/workspace/chat-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "New conversation",
}

export default async function NewChatPage() {
  const user = await requireWorkspaceUser()
  const workspace = await getWorkspace(user.id, { draft: true })

  return <ChatView mode="draft" chatId={null} initial={workspace} />
}
