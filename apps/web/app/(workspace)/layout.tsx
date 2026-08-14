import { requireWorkspaceUser } from "@/lib/app-session"
import { getWorkspace, getInstanceSettings } from "@/lib/chat-service"
import { listProviders } from "@/lib/providers"
import { WorkspaceShell } from "@/components/workspace/shell"
import { ThemeProvider } from "@/components/theme-provider"
import { ThemeBootstrap } from "@/components/workspace/theme-bootstrap"

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
    <ThemeProvider>
      <ThemeBootstrap
        themes={settings.themes}
        lightThemeId={settings.lightThemeId}
        darkThemeId={settings.darkThemeId}
      />
      <WorkspaceShell
        initialChats={workspace.chats}
        providers={providers}
        themes={settings.themes}
        lightThemeId={settings.lightThemeId}
        darkThemeId={settings.darkThemeId}
      >
        {children}
      </WorkspaceShell>
    </ThemeProvider>
  )
}
