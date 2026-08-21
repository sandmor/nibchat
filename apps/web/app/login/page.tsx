import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth-card"
import { getRequestGate, workspaceHomePath } from "@/lib/app-session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Sign in",
}

export default async function LoginPage() {
  const gate = await getRequestGate()
  if (gate.status === "setup" || gate.status === "onboarding")
    redirect("/setup")
  if (gate.status === "ok") redirect(await workspaceHomePath(gate.user.id))
  return <AuthCard />
}
