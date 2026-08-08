import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth-card"
import { getRequestGate, workspaceHomePath } from "@/lib/app-session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Setup",
}

export default async function SetupPage() {
  const gate = await getRequestGate()
  if (gate.status === "setup") return <AuthCard setup />
  if (gate.status === "ok") redirect(await workspaceHomePath(gate.user.id))
  redirect("/login")
}
