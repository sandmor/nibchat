"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon } from "@hugeicons/core-free-icons"
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
import { Label } from "@/components/ui/label"
import { MAX_NAME } from "@/lib/limits"
import { useTRPC } from "@/lib/trpc-react"

function nodeCountLabel(count: number) {
  return `${count} message${count === 1 ? "" : "s"}`
}

function TemplateNameField({
  templateId,
  name,
  onCommit,
}: {
  templateId: string
  name: string
  onCommit: (name: string) => void
}) {
  const [text, setText] = useState(name)
  useEffect(() => {
    setText(name)
  }, [name])

  function commit() {
    const next = text.trim()
    if (!next || next === name) {
      setText(name)
      return
    }
    onCommit(next)
  }

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <Label htmlFor={`chat-template-name-${templateId}`} className="sr-only">
        Template name
      </Label>
      <Input
        id={`chat-template-name-${templateId}`}
        value={text}
        maxLength={MAX_NAME}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
        }}
      />
    </div>
  )
}

export function ChatTemplateSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const templates = useQuery(trpc.workspace.listChatTemplates.queryOptions())
  const [deleteTemplate, setDeleteTemplate] = useState<{
    id: string
    name: string
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
        await queryClient.invalidateQueries(
          trpc.workspace.listChatTemplates.queryFilter()
        )
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
          Save a conversation from its menu. New chats can start from that
          complete tree, and a space can set one as the default.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {rows.map((template) => (
          <div
            key={template.id}
            className="flex flex-col gap-3 rounded-xl ring-1 ring-foreground/8 sm:flex-row sm:items-center sm:px-3 sm:py-2"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3 p-3 sm:items-center sm:p-0">
              <TemplateNameField
                templateId={template.id}
                name={template.name}
                onCommit={(name) =>
                  rename.mutate({ templateId: template.id, name })
                }
              />
              <p className="hidden shrink-0 pt-2 text-xs text-muted-foreground sm:block sm:pt-0">
                {nodeCountLabel(template.document.nodes.length)}
                {template.document.expandMessageMacros ? " · macros" : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1 px-3 pb-3 sm:px-0 sm:pb-0">
              <p className="me-auto text-xs text-muted-foreground sm:hidden">
                {nodeCountLabel(template.document.nodes.length)}
                {template.document.expandMessageMacros ? " · macros" : ""}
              </p>
              <Link
                href={`/chat/new?template=${encodeURIComponent(template.id)}`}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Use
              </Link>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${template.name}`}
                disabled={remove.isPending}
                onClick={() =>
                  setDeleteTemplate({ id: template.id, name: template.name })
                }
              >
                <HugeiconsIcon icon={Delete02Icon} className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        {templates.isSuccess && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No chat templates yet. Open a conversation and choose Save as
            template.
          </p>
        ) : null}
      </CardContent>
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
