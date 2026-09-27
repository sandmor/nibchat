"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTRPC } from "@/lib/trpc-react"
import type { ModelConfig } from "@/lib/chat-settings"
import type { ProviderSummary } from "../types"
import { ModelPicker } from "../model-picker"
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
import { MetaLine } from "@/components/ui/inline-separator"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  MAX_COLLECTION,
  MAX_DESCRIPTION,
  MAX_ID,
  MAX_SPACE_DEPTH,
} from "@/lib/limits"

const helperKeyPattern = /^[a-z][a-z0-9_]*$/

type Profile = {
  id: string
  key: string
  name: string
  description: string
  promptStackId: string
  model: ModelConfig | null
  mcpMode: "inherit" | "none"
  allowTask: boolean
  contextMode: "conversation" | "task"
}

export function HelperSettings({
  providers,
}: {
  providers: ProviderSummary[]
}) {
  const trpc = useTRPC()
  const client = useQueryClient()
  const profiles = useQuery(trpc.workspace.listHelperProfiles.queryOptions())
  const settings = useQuery(trpc.workspace.getSettings.queryOptions())
  const [stepDraft, setStepDraft] = useState<string | null>(null)
  const limits = useMutation(
    trpc.workspace.setAgentLimits.mutationOptions({
      onSuccess: async () => {
        setStepDraft(null)
        await client.invalidateQueries({
          queryKey: trpc.workspace.getSettings.queryKey(),
        })
        toast.success("Helper limits saved")
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const savedDepth = settings.data?.agentDepth ?? 1
  const savedSteps = settings.data?.maxModelSteps ?? 20
  const stacks = useQuery({
    ...trpc.workspace.listPromptStacks.queryOptions(),
    enabled: profiles.isSuccess,
  })
  const [editing, setEditing] = useState<Profile | null>(null)
  const [isNew, setIsNew] = useState(false)
  const refresh = async () => {
    await client.invalidateQueries({
      queryKey: trpc.workspace.listHelperProfiles.queryKey(),
    })
  }
  const save = useMutation(
    trpc.workspace.saveHelperProfile.mutationOptions({
      onSuccess: async () => {
        toast.success("Helper saved")
        setEditing(null)
        setIsNew(false)
        await refresh()
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const remove = useMutation(
    trpc.workspace.deleteHelperProfile.mutationOptions({
      onSuccess: async () => {
        toast.success("Helper deleted")
        setDeleteId(null)
        setEditing(null)
        await refresh()
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const newProfile = () => {
    setEditing({
      id: "",
      key: "",
      name: "",
      description: "",
      promptStackId: stacks.data?.[0]?.id ?? "",
      model: null,
      mcpMode: "inherit",
      allowTask: true,
      contextMode: "conversation",
    })
    setIsNew(true)
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Helpers</CardTitle>
        <CardDescription>
          Optional specialists for delegated tasks. An ordinary task works
          without any setup. Edit specialist instructions in Prompt stacks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="helper-depth">Maximum helper depth</Label>
            <Select
              value={String(savedDepth)}
              disabled={settings.isPending || limits.isPending}
              onValueChange={(value) =>
                limits.mutate({
                  agentDepth: Number(value),
                  maxModelSteps: savedSteps,
                })
              }
            >
              <SelectTrigger id="helper-depth">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: MAX_SPACE_DEPTH }, (_, index) => {
                  const depth = index + 1
                  return (
                    <SelectItem key={depth} value={String(depth)}>
                      {depth === 1 ? "1 level" : `${depth} levels`}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-step-limit">Model steps per reply</Label>
            <Input
              id="model-step-limit"
              type="number"
              min={1}
              max={MAX_COLLECTION}
              step={1}
              value={stepDraft ?? String(savedSteps)}
              disabled={settings.isPending || limits.isPending}
              onChange={(event) => setStepDraft(event.target.value)}
              onBlur={() => {
                if (stepDraft === null) return
                const value = Number(stepDraft)
                if (
                  !Number.isInteger(value) ||
                  value < 1 ||
                  value > MAX_COLLECTION
                ) {
                  toast.error(`Enter 1 to ${MAX_COLLECTION} model steps`)
                  setStepDraft(null)
                } else if (value !== savedSteps) {
                  limits.mutate({
                    agentDepth: savedDepth,
                    maxModelSteps: value,
                  })
                } else setStepDraft(null)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur()
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            The depth counts helper layers. The model step limit applies to
            every reply.
          </p>
        </div>
        <div className="space-y-2">
          {(profiles.data ?? []).map((profile) => (
            <div
              key={profile.id}
              className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 sm:flex-1">
                <p className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium">
                    {profile.name}
                  </span>
                </p>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  <MetaLine items={[profile.key, profile.description]} />
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(profile)
                    setIsNew(false)
                  }}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  aria-label={`Delete ${profile.name}`}
                  onClick={() => setDeleteId(profile.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {profiles.isSuccess && (profiles.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No specialists yet.</p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={newProfile}
          >
            Add helper
          </Button>
        </div>
        {editing && (
          <div className="grid gap-4 rounded-xl border p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="helper-name">Name</Label>
              <Input
                id="helper-name"
                value={editing.name}
                onChange={(event) =>
                  setEditing({ ...editing, name: event.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="helper-key">Key</Label>
              <Input
                id="helper-key"
                value={editing.key}
                maxLength={MAX_ID}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
                aria-invalid={
                  editing.key.length > 0 && !helperKeyPattern.test(editing.key)
                }
                onChange={(event) =>
                  setEditing({ ...editing, key: event.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, digits, and underscores. Models pass this key
                when they choose a helper.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="helper-description">
                When to use this helper
              </Label>
              <Textarea
                id="helper-description"
                value={editing.description}
                maxLength={MAX_DESCRIPTION}
                onChange={(event) =>
                  setEditing({ ...editing, description: event.target.value })
                }
              />
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="helper-stack">Prompt stack</Label>
                <Select
                  value={editing.promptStackId || stacks.data?.[0]?.id || ""}
                  onValueChange={(value) => {
                    if (value) setEditing({ ...editing, promptStackId: value })
                  }}
                >
                  <SelectTrigger id="helper-stack" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(stacks.data ?? []).map((stack) => (
                      <SelectItem key={stack.id} value={stack.id}>
                        {stack.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="helper-context">Default context</Label>
                <Select
                  value={editing.contextMode}
                  onValueChange={(value) =>
                    setEditing({
                      ...editing,
                      contextMode: value as "conversation" | "task",
                    })
                  }
                >
                  <SelectTrigger id="helper-context" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conversation">
                      Current conversation
                    </SelectItem>
                    <SelectItem value="task">Assignment only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1">
              <label className="flex items-start gap-3 rounded-md px-1 py-2">
                <Switch
                  id="helper-mcp"
                  size="sm"
                  className="mt-0.5"
                  checked={editing.mcpMode === "inherit"}
                  onCheckedChange={(checked) =>
                    setEditing({
                      ...editing,
                      mcpMode: checked ? "inherit" : "none",
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">MCP tools</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Use the tools enabled for this account.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-md px-1 py-2">
                <Switch
                  id="helper-delegation"
                  size="sm"
                  className="mt-0.5"
                  checked={editing.allowTask}
                  onCheckedChange={(checked) =>
                    setEditing({ ...editing, allowTask: checked })
                  }
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    Can start other helpers
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Only while nested depth still allows another level.
                  </span>
                </span>
              </label>
            </div>
            <div className="grid gap-1.5">
              <Label>Model</Label>
              {editing.model ? (
                <div className="flex flex-wrap items-center gap-2">
                  <ModelPicker
                    config={editing.model}
                    providers={providers}
                    quiet
                    emptyLabel={
                      editing.model.providerId ? undefined : "Choose a model"
                    }
                    onChange={(model) => setEditing({ ...editing, model })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing({ ...editing, model: null })}
                  >
                    Use parent model
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    Same as the parent chat
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditing({ ...editing, model: {} })}
                  >
                    Choose a model
                  </Button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={
                  save.isPending ||
                  !editing.name.trim() ||
                  !helperKeyPattern.test(editing.key) ||
                  !editing.description.trim() ||
                  !(editing.promptStackId || stacks.data?.[0]?.id)
                }
                onClick={() =>
                  save.mutate({
                    ...(isNew ? {} : { id: editing.id }),
                    key: editing.key,
                    name: editing.name,
                    description: editing.description,
                    promptStackId:
                      editing.promptStackId || stacks.data?.[0]?.id || "",
                    model:
                      editing.model?.providerId && editing.model.model
                        ? editing.model
                        : null,
                    mcpMode: editing.mcpMode,
                    allowTask: editing.allowTask,
                    contextMode: editing.contextMode,
                  })
                }
              >
                Save helper
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(null)
                  setIsNew(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
      <AlertDialog
        open={deleteId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete helper?</AlertDialogTitle>
            <AlertDialogDescription>
              Chats already using it keep their snapshot. New tasks will not be
              able to choose this key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || !deleteId}
              onClick={() => {
                if (deleteId) remove.mutate({ id: deleteId })
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
