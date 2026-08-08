"use client"

import { useRef } from "react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function BackupSettings() {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup & restore</CardTitle>
        <CardDescription>
          API keys are never included. Restore only works when this instance has
          zero chats.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <a
          href="/api/backup"
          download
          className={buttonVariants({ variant: "outline" })}
        >
          Download full backup
        </a>
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          Restore backup
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              const body = JSON.parse(await file.text())
              const response = await fetch("/api/restore", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              })
              const payload = await response.json()
              if (!response.ok)
                throw new Error(payload.error ?? "Restore failed")
              toast.success("Backup restored")
              location.reload()
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "Restore failed"
              )
            } finally {
              event.target.value = ""
            }
          }}
        />
      </CardContent>
    </Card>
  )
}
