"use client"

import { useEffect, useRef, useState } from "react"
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
import { Input } from "@/components/ui/input"
import { templateActiveLeaf } from "@/lib/chat-template"
import { MAX_NAME } from "@/lib/limits"
import { formatCadence, type Cadence } from "@/lib/schedules/cadence"
import { useTRPC } from "@/lib/trpc-react"
import { ScheduleDialog } from "../schedule-dialog"

function nodeCountLabel(count: number) {
  return `${count} message${count === 1 ? "" : "s"}`
}

function templateScheduleLabel(rows: { enabled: boolean; cadence: Cadence }[]) {
  if (rows.length === 0) return null
  if (rows.length === 1) {
    const row = rows[0]!
    const cadence = formatCadence(row.cadence)
    return row.enabled ? cadence : `${cadence} · paused`
  }
  const count = `${rows.length} schedules`
  return rows.every((row) => !row.enabled) ? `${count} · paused` : count
}

function TemplateName({
  templateId,
  name,
  onCommit,
}: {
  templateId: string
  name: string
  onCommit: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(name)
  const cancelRef = useRef(false)
  useEffect(() => {
    setText(name)
  }, [name])

  function commit() {
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
    const next = text.trim()
    if (!next || next === name) {
      setText(name)
      return
    }
    onCommit(next)
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="block max-w-full truncate text-left font-medium"
        title="Rename"
        aria-label={`Rename ${name}`}
        onClick={() => {
          setText(name)
          setEditing(true)
        }}
      >
        {name}
      </button>
    )
  }

  return (
    <Input
      id={`chat-template-name-${templateId}`}
      aria-label="Template name"
      autoFocus
      value={text}
      maxLength={MAX_NAME}
      className="h-8"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        commit()
        setEditing(false)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          event.preventDefault()
          cancelRef.current = true
          setText(name)
          setEditing(false)
        }
      }}
    />
  )
}

export function ChatTemplateSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const templates = useQuery(trpc.workspace.listChatTemplates.queryOptions())
  const schedules = useQuery(trpc.workspace.listSchedules.queryOptions())
  const [deleteTemplate, setDeleteTemplate] = useState<{
    id: string
    name: string
  } | null>(null)
  const [scheduleTemplate, setScheduleTemplate] = useState<{
    id: string
    name: string
    leafIsUser: boolean
  } | null>(null)
  const remove = useMutation(
    trpc.workspace.deleteChatTemplate.mutationOptions({
      onSuccess: async () => {
        setDeleteTemplate(null)
        await queryClient.invalidateQueries(
          trpc.workspace.listChatTemplates.queryFilter()
        )
        toast.success("Chat template deleted")
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const rename = useMutation(
    trpc.workspace.renameChatTemplate.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(
            trpc.workspace.listChatTemplates.queryFilter()
          ),
          queryClient.invalidateQueries(
            trpc.workspace.listSchedules.queryFilter()
          ),
        ])
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const rows = templates.data ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat templates</CardTitle>
        <CardDescription>
          Save a conversation from its menu. New chats can start from it, and a
          space can set one as the default.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.map((template) => {
          const scheduleLabel = templateScheduleLabel(
            (schedules.data?.schedules ?? []).filter(
              (schedule) => schedule.templateId === template.id
            )
          )
          return (
            <div
              key={template.id}
              className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 sm:flex-1">
                <TemplateName
                  templateId={template.id}
                  name={template.name}
                  onCommit={(name) =>
                    rename.mutate({ templateId: template.id, name })
                  }
                />
                <p
                  className="line-clamp-2 text-xs text-muted-foreground"
                  suppressHydrationWarning
                >
                  {nodeCountLabel(template.document.nodes.length)}
                  {template.document.expandMessageMacros ? " · macros" : ""}
                  {scheduleLabel ? ` · ${scheduleLabel}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Link
                  href={`/chat/new?template=${encodeURIComponent(template.id)}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Use
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setScheduleTemplate({
                      id: template.id,
                      name: template.name,
                      leafIsUser:
                        templateActiveLeaf(template.document)?.role === "user",
                    })
                  }
                >
                  Schedule
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  aria-label={`Delete ${template.name}`}
                  disabled={remove.isPending}
                  onClick={() =>
                    setDeleteTemplate({ id: template.id, name: template.name })
                  }
                >
                  Delete
                </Button>
              </div>
            </div>
          )
        })}
        {templates.isSuccess && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No chat templates yet. Open a conversation and choose Save as
            template.
          </p>
        ) : null}
      </CardContent>
      <ScheduleDialog
        open={Boolean(scheduleTemplate)}
        onOpenChange={(open) => {
          if (!open) setScheduleTemplate(null)
        }}
        source={
          scheduleTemplate
            ? {
                kind: "template",
                templateId: scheduleTemplate.id,
                templateName: scheduleTemplate.name,
                leafIsUser: scheduleTemplate.leafIsUser,
              }
            : null
        }
      />
      <AlertDialog
        open={Boolean(deleteTemplate)}
        onOpenChange={(open) => {
          if (!open) setDeleteTemplate(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTemplate
                ? `${deleteTemplate.name} will be removed. Existing chats stay as they are. Spaces using it will fall back to a blank start.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!deleteTemplate || remove.isPending}
              onClick={() => {
                if (!deleteTemplate) return
                remove.mutate({ templateId: deleteTemplate.id })
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
