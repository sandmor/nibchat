"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { formatCadence, formatRunInstant } from "@/lib/schedules/cadence"
import { useTRPC } from "@/lib/trpc-react"
import { displayChatTitle } from "@/lib/chat-title"
import { ScheduleDialog, type ScheduleDialogSchedule } from "../schedule-dialog"

type ScheduleRow = ScheduleDialogSchedule & {
  templateName: string | null
  action:
    | { kind: "template"; templateId: string; spaceId: string | null }
    | { kind: "chat_generate"; chatId: string }
  enabled: boolean
  nextRunAt: string | null
  lastStatus:
    | "running"
    | "complete"
    | "awaiting_input"
    | "error"
    | "skipped"
    | null
  lastError: string | null
  lastChatId: string | null
}

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

function statusLine(schedule: ScheduleRow, now: Date) {
  if (schedule.lastStatus === "running")
    return { text: "Running", tone: "attention" as const }
  if (schedule.lastStatus === "awaiting_input")
    return {
      text: "Waiting for you in the last chat",
      tone: "attention" as const,
    }
  if (schedule.lastStatus === "error")
    return {
      text: schedule.lastError ?? "The last run failed",
      tone: "danger" as const,
    }
  if (!schedule.enabled)
    return {
      text:
        schedule.cadence.kind === "once" && schedule.lastStatus
          ? "Finished"
          : "Paused",
      tone: "muted" as const,
    }
  if (!schedule.nextRunAt) return { text: "Finished", tone: "muted" as const }
  if (new Date(schedule.nextRunAt).getTime() <= now.getTime())
    return { text: "Due now", tone: "attention" as const }
  return {
    text: `Next ${formatRunInstant(schedule.nextRunAt, schedule.cadence.timeZone)}`,
    tone: "muted" as const,
  }
}

function onceSettled(schedule: ScheduleRow) {
  return (
    schedule.cadence.kind === "once" &&
    (!schedule.nextRunAt || (!schedule.enabled && schedule.lastStatus != null))
  )
}

function scheduleMeta(
  schedule: ScheduleRow,
  spaceName: string,
  here: string,
  chatLabel: string
) {
  const parts: string[] = []
  if (
    schedule.templateName &&
    schedule.templateName.trim() !== schedule.name.trim()
  )
    parts.push(schedule.templateName)
  parts.push(schedule.action.kind === "template" ? spaceName : chatLabel)
  parts.push(formatCadence(schedule.cadence))
  if (schedule.cadence.timeZone !== here) parts.push(schedule.cadence.timeZone)
  return parts.join(" · ")
}

export function ScheduleSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const schedules = useQuery(trpc.workspace.listSchedules.queryOptions())
  const workspace = useQuery(trpc.workspace.get.queryOptions({ draft: true }))
  const [editing, setEditing] = useState<ScheduleDialogSchedule | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
    kind: ScheduleRow["action"]["kind"]
  } | null>(null)
  const available = schedules.data?.available ?? true
  const rows = (schedules.data?.schedules ?? []) as ScheduleRow[]
  const spaces = workspace.data?.spaces ?? []
  const chats = workspace.data?.chats ?? []
  const here = browserTimeZone()

  async function refresh() {
    await queryClient.invalidateQueries(
      trpc.workspace.listSchedules.queryFilter()
    )
  }

  const remove = useMutation(
    trpc.workspace.deleteSchedule.mutationOptions({
      onSuccess: async () => {
        setDeleteTarget(null)
        await refresh()
        toast.success("Schedule deleted")
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const setEnabled = useMutation(
    trpc.workspace.updateSchedule.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(error.message),
    })
  )
  const runNow = useMutation(
    trpc.workspace.runScheduleNow.mutationOptions({
      onSuccess: async (schedule) => {
        await refresh()
        if (schedule?.lastStatus === "error")
          toast.error(schedule.lastError ?? "The run failed")
        else toast.success("Run started")
      },
      onError: (error) => toast.error(error.message),
    })
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Schedules</CardTitle>
        <CardDescription>
          Run templates repeatedly, or generate from a message in an existing
          chat later.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {schedules.isSuccess && !available ? (
          <p className="text-sm text-muted-foreground">
            This server is in stateless generation mode, so schedules stay
            stored and do not run.
          </p>
        ) : null}
        {rows.map((schedule) => {
          const openChatId =
            schedule.lastChatId ??
            (schedule.action.kind === "template"
              ? null
              : schedule.action.chatId)
          const status = statusLine(schedule, new Date())
          const spaceName =
            spaces.find((space) => space.id === schedule.spaceId)?.name ??
            "Ungrouped"
          const scheduledChatId =
            schedule.action.kind === "template" ? null : schedule.action.chatId
          const scheduledChat = scheduledChatId
            ? chats.find((chat) => chat.id === scheduledChatId)
            : undefined
          const chatLabel =
            scheduledChatId && workspace.isSuccess && !scheduledChat
              ? "Deleted chat"
              : displayChatTitle(scheduledChat?.title)
          const settled = onceSettled(schedule)
          const cancelChat = schedule.action.kind !== "template"
          const statusText =
            schedule.lastStatus === "skipped" && schedule.enabled
              ? `${status.text} · the previous run was still going`
              : status.text
          const statusClass =
            status.tone === "danger"
              ? "text-destructive"
              : status.tone === "attention"
                ? "font-medium text-foreground"
                : ""
          return (
            <div
              key={schedule.id}
              className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{schedule.name}</p>
                <p
                  className="line-clamp-2 text-xs text-muted-foreground"
                  suppressHydrationWarning
                >
                  {scheduleMeta(schedule, spaceName, here, chatLabel)}
                  <span className={statusClass}> · {statusText}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {!settled ? (
                  <Switch
                    size="sm"
                    checked={schedule.enabled}
                    disabled={
                      setEnabled.isPending || (!available && !schedule.enabled)
                    }
                    aria-label={`${schedule.enabled ? "Pause" : "Resume"} ${schedule.name}`}
                    onCheckedChange={(checked) => {
                      setEnabled.mutate({ id: schedule.id, enabled: checked })
                    }}
                  />
                ) : null}
                {openChatId ? (
                  <Link
                    href={`/chat/${openChatId}`}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Open{" "}
                    {schedule.action.kind === "template" ? "last chat" : "chat"}
                  </Link>
                ) : null}
                {!settled ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!available || runNow.isPending}
                    onClick={() => runNow.mutate({ id: schedule.id })}
                  >
                    Run now
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditing({
                      id: schedule.id,
                      name: schedule.name,
                      spaceId: schedule.spaceId,
                      cadence: schedule.cadence,
                      replyCount: schedule.replyCount,
                      actionKind: schedule.action.kind,
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  aria-label={`${cancelChat ? "Cancel" : "Delete"} ${schedule.name}`}
                  onClick={() =>
                    setDeleteTarget({
                      id: schedule.id,
                      name: schedule.name,
                      kind: schedule.action.kind,
                    })
                  }
                >
                  {cancelChat ? "Cancel" : "Delete"}
                </Button>
              </div>
            </div>
          )
        })}
        {schedules.isSuccess && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Open a chat that ends with your message and save it as a template to
            run on a schedule, or choose Generate later on a message.
          </p>
        ) : null}
      </CardContent>
      <ScheduleDialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        source={editing ? { kind: "edit", schedule: editing } : null}
      />
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.kind === "template"
                ? "Delete schedule?"
                : "Cancel schedule?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? deleteTarget.kind === "template"
                  ? `${deleteTarget.name} will stop running. The template and chats it already created stay.`
                  : `${deleteTarget.name} will not run. The chat and its messages stay.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {deleteTarget?.kind === "template" ? "Cancel" : "Keep it"}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!deleteTarget || remove.isPending}
              onClick={() => {
                if (!deleteTarget) return
                remove.mutate({ id: deleteTarget.id })
              }}
            >
              {deleteTarget?.kind === "template" ? "Delete" : "Cancel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
