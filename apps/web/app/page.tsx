import { redirect } from "next/navigation"
import { getRequestGate, workspaceHomePath } from "@/lib/app-session"

export const dynamic = "force-dynamic"

export default async function Page() {
  const gate = await getRequestGate()
  if (gate.status === "setup") redirect("/setup")
  if (gate.status === "login" || gate.status === "wrong_account")
    redirect("/login")
  redirect(await workspaceHomePath(gate.user.id))
}
