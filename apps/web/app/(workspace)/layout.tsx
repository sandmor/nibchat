import { requireWorkspaceUser } from "@/lib/app-session"
import { getWorkspace, getInstanceSettings } from "@/lib/chat-service"
import { listProviders } from "@/lib/providers"
import { WorkspaceShell } from "@/components/workspace/shell"

export const dynamic = "force-dynamic"

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireWorkspaceUser()
  const [settings, workspace, providers] = await Promise.all([
    getInstanceSettings(),
    getWorkspace(user.id, { draft: true }),
    listProviders(user.id),
  ])

  return (
    <WorkspaceShell
      initialChats={workspace.chats}
      providers={providers}
      appearance={settings.appearance}
    >
      {children}
    </WorkspaceShell>
  )
}
