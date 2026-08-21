import { requireWorkspaceUser } from "@/lib/app-session"
import { getWorkspace, getInstanceSettings } from "@/lib/chat-service"
import { listAvailableProviders, listProviders } from "@/lib/providers"
import { WorkspaceShell } from "@/components/workspace/shell"
import { ThemeProvider } from "@/components/theme-provider"
import { ThemeBootstrap } from "@/components/workspace/theme-bootstrap"
import { getOwnerUserId } from "@/lib/identity/adapters/kysely-instance"

export const dynamic = "force-dynamic"

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireWorkspaceUser()
  const ownerId = await getOwnerUserId()
  const [settings, workspace, providers] = await Promise.all([
    getInstanceSettings(user.id),
    getWorkspace(user.id, { draft: true }),
    user.id === ownerId ? listProviders() : listAvailableProviders(),
  ])
  const visibleSettings = user.id === ownerId
    ? settings
    : { ...settings, titleModelConfig: null }

  return (
    <ThemeProvider userId={user.id} initialMode={settings.themeMode}>
      <ThemeBootstrap
        themes={visibleSettings.themes}
        lightThemeId={visibleSettings.lightThemeId}
        darkThemeId={visibleSettings.darkThemeId}
        userId={user.id}
      />
      <WorkspaceShell
        initialChats={workspace.chats}
        providers={providers}
        initialSettings={visibleSettings}
        user={user}
        isOwner={user.id === ownerId}
      >
        {children}
      </WorkspaceShell>
    </ThemeProvider>
  )
}
