import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { SetupWizard } from "@/components/setup-wizard"
import { getRequestGate, workspaceHomePath } from "@/lib/app-session"
import { listProviders } from "@/lib/providers"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Setup",
}

export default async function SetupPage() {
  const gate = await getRequestGate()
  if (gate.status === "setup") return <SetupWizard initialStep="owner" />
  if (gate.status === "onboarding") {
    const providers = await listProviders()
    return (
      <SetupWizard
        initialStep="provider"
        initialProvider={providers[0] ?? null}
      />
    )
  }
  if (gate.status === "ok") redirect(await workspaceHomePath(gate.user.id))
  redirect("/login")
}
