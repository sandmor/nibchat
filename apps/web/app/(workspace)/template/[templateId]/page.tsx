import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { requireWorkspaceUser } from "@/lib/app-session"
import { getWorkspace } from "@/lib/chat-service"
import { getTemplateChat } from "@/lib/chat-template-service"
import { ChatView } from "@/components/workspace/chat-view"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ templateId: string }>
}): Promise<Metadata> {
  const user = await requireWorkspaceUser()
  const { templateId } = await params
  const template = await getTemplateChat(user.id, templateId)
  return { title: template?.name ?? "Chat template" }
}

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const user = await requireWorkspaceUser()
  const { templateId } = await params
  const template = await getTemplateChat(user.id, templateId)
  if (!template) notFound()
  const workspace = await getWorkspace(user.id, {
    chatId: template.chat_id,
  })
  if (!workspace.chat) notFound()
  return (
    <ChatView
      key={template.chat_id}
      mode="chat"
      chatId={template.chat_id}
      initial={workspace}
      template={{ id: template.id, name: template.name }}
    />
  )
}
