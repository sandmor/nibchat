import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { requireWorkspaceUser } from "@/lib/app-session"
import { getWorkspace } from "@/lib/chat-service"
import { SpaceView } from "@/components/workspace/space-view"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ spaceId: string }>
}): Promise<Metadata> {
  const { spaceId } = await params
  const user = await requireWorkspaceUser()
  const workspace = await getWorkspace(user.id, { draft: true })
  const space = workspace.spaces.find((row) => row.id === spaceId)
  return { title: space?.name ?? "Space" }
}

export default async function SpacePage({
  params,
}: {
  params: Promise<{ spaceId: string }>
}) {
  const { spaceId } = await params
  const user = await requireWorkspaceUser()
  const workspace = await getWorkspace(user.id, { draft: true })
  if (!workspace.spaces.some((row) => row.id === spaceId)) {
    redirect("/chat/new")
  }
  return <SpaceView key={spaceId} spaceId={spaceId} initial={workspace} />
}
