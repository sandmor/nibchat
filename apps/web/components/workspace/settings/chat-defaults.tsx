"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTRPC } from "@/lib/trpc-react"
import { PRODUCT_DEFAULTS, toModelConfig } from "@/lib/chat-settings"
import type { ModelConfigLocal, ProviderSummary } from "../types"
import { ModelPicker } from "../model-picker"
import { ReasoningPicker } from "../reasoning-picker"
import { GenerationParameters } from "../generation-parameters"

export function ChatDefaultsSettings({
  providers,
}: {
  providers: ProviderSummary[]
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  const query = useQuery(trpc.workspace.getSettings.queryOptions())
  const [parametersOpen, setParametersOpen] = useState(false)
  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries(trpc.workspace.getSettings.queryFilter()),
      queryClient.invalidateQueries(trpc.workspace.get.queryFilter()),
    ])
    router.refresh()
  }
  const save = useMutation(
    trpc.workspace.setChatDefaults.mutationOptions({ onSuccess: refresh })
  )
  const stackSave = useMutation(
    trpc.workspace.setUserPromptStack.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(error.message),
    })
  )
  async function commit(config: ModelConfigLocal) {
    await save.mutateAsync(config)
  }
  const settings = query.data
  return (
    <Card>
      <CardHeader>
        <CardTitle>New chat defaults</CardTitle>
        <CardDescription>
          Existing chats follow these values until they override a key. A space
          that requires a setting still wins.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {settings ? (
          <fieldset
            disabled={save.isPending || stackSave.isPending}
            className="grid gap-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <ModelPicker
                config={settings.chatDefaults}
                providers={providers}
                onChange={commit}
                successToast="Default model updated"
              />
              <ReasoningPicker
                config={settings.chatDefaults}
                providers={providers}
                onChange={commit}
                onEditParameters={() => setParametersOpen(true)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setParametersOpen(true)}
              >
                Chat settings
              </Button>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="default-chat-stack">Prompt stack</Label>
              <Select
                value={settings.defaultPromptStackId}
                items={Object.fromEntries(
                  settings.promptStacks.map((stack) => [stack.id, stack.name])
                )}
                onValueChange={(stackId) => {
                  if (stackId) stackSave.mutate({ stackId })
                }}
              >
                <SelectTrigger id="default-chat-stack">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {settings.promptStacks.map((stack) => (
                    <SelectItem key={stack.id} value={stack.id}>
                      {stack.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <GenerationParameters
              open={parametersOpen}
              onOpenChange={setParametersOpen}
              config={settings.chatDefaults}
              inherited={toModelConfig(PRODUCT_DEFAULTS)}
              onChange={commit}
              defaults
            />
          </fieldset>
        ) : (
          <p className="text-sm text-muted-foreground">
            {query.isError ? "Could not load defaults." : "Loading defaults…"}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
