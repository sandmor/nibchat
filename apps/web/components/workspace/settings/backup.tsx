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
          Downloads a zip with chat metadata and original attachment files. API
          keys are never included. Restore only works when this instance has
          zero chats.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <a
          href="/api/backup"
          download="nibchat-backup.zip"
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
          accept="application/zip,.zip,application/json,.json"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0]
            if (!file) return
            try {
              const response = await fetch("/api/restore", {
                method: "POST",
                headers: {
                  "content-type": file.type || "application/octet-stream",
                },
                body: file,
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
