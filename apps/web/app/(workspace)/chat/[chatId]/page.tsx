import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getRequestGate, requireWorkspaceUser } from "@/lib/app-session"
import { getWorkspace } from "@/lib/chat-service"
import { db } from "@/lib/db"
import { ChatView } from "@/components/workspace/chat-view"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ chatId: string }>
}): Promise<Metadata> {
  const { chatId } = await params
  const gate = await getRequestGate()
  if (gate.status !== "ok") return { title: { absolute: "Nibchat" } }
  const chat = await db
    .selectFrom("chats")
    .select("title")
    .where("id", "=", chatId)
    .where("user_id", "=", gate.user.id)
    .executeTakeFirst()
  if (!chat) return { title: "New conversation" }
  return { title: chat.title }
}

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ chatId: string }>
  searchParams: Promise<{ node?: string }>
}) {
  const { chatId } = await params
  const { node } = await searchParams
  const user = await requireWorkspaceUser()
  const workspace = await getWorkspace(user.id, { chatId })

  if (!workspace.chat) {
    redirect("/chat/new")
  }

  return (
    <ChatView
      key={chatId}
      mode="chat"
      chatId={chatId}
      initial={workspace}
      selectNodeId={node ?? null}
    />
  )
}
