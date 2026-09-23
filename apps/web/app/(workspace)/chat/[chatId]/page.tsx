import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getRequestGate, requireWorkspaceUser } from "@/lib/app-session"
import { getWorkspace } from "@/lib/chat-service"
import { db } from "@/lib/db"
import { displayChatTitle } from "@/lib/chat-title"
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
  return { title: displayChatTitle(chat.title) }
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
  const template = await db.selectFrom("template_chats")
    .innerJoin("chat_templates", "chat_templates.id", "template_chats.template_id")
    .select("chat_templates.id")
    .where("template_chats.chat_id", "=", chatId)
    .where("chat_templates.user_id", "=", user.id)
    .executeTakeFirst()
  if (template) redirect(`/template/${template.id}`)
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
