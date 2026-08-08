import type { Metadata } from "next"
import { SettingsView } from "@/components/workspace/settings-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Settings",
}

export default function SettingsPage() {
  return <SettingsView />
}
