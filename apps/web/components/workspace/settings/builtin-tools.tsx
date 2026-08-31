"use client"

import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useTRPC } from "@/lib/trpc-react"
import { builtInToolCatalog } from "@/lib/agent/tools/catalog"

export function BuiltInToolsSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const disabled = settingsQuery.data?.builtInTools.disabled ?? []

  const setMut = useMutation(
    trpc.workspace.setBuiltInTools.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.getSettings.queryKey(),
        })
      },
      onError: (error) =>
        toast.error(error.message || "Could not update built-in tools"),
    })
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Built-in tools</CardTitle>
        <CardDescription>
          First-party tools the model may call in your chats. These apply only
          to you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {builtInToolCatalog.map((tool) => {
          const enabled = !disabled.includes(tool.id)
          return (
            <label
              key={tool.id}
              className="flex items-start gap-3 rounded-md px-1 py-2"
            >
              <Switch
                size="sm"
                className="mt-0.5"
                checked={enabled}
                disabled={setMut.isPending || settingsQuery.isPending}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? disabled.filter((id) => id !== tool.id)
                    : [...disabled, tool.id]
                  setMut.mutate({ disabled: next })
                }}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{tool.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {tool.description}
                </span>
              </span>
            </label>
          )
        })}
      </CardContent>
    </Card>
  )
}
