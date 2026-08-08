import { headers } from "next/headers"
import { AuthCard } from "@/components/auth-card"
import { Workspace } from "@/components/workspace"
import { db, migrate } from "@/lib/db"
import { sessionFromHeaders, requireOwner } from "@/lib/auth"
import { getWorkspace, getInstanceSettings } from "@/lib/chat-service"
import { listProviders } from "@/lib/providers"

export const dynamic = "force-dynamic"
export default async function Page() {
  await migrate()
  const instance = await db
    .selectFrom("instance")
    .select("owner_user_id")
    .where("id", "=", 1)
    .executeTakeFirstOrThrow()
  const requestHeaders = await headers()
  const session = await sessionFromHeaders(requestHeaders)
  if (!session) return <AuthCard setup={!instance.owner_user_id} />

  let user: Awaited<ReturnType<typeof requireOwner>>
  try {
    user = await requireOwner(requestHeaders)
  } catch {
    return <AuthCard setup={false} wrongAccount />
  }

  const [settings, workspace, providers] = await Promise.all([
    getInstanceSettings(),
    getWorkspace(user.id),
    listProviders(user.id),
  ])
  return (
    <Workspace
      initial={workspace}
      providers={providers}
      appearance={settings.appearance}
    />
  )
}
