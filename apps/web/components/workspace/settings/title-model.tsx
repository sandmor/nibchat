"use client"

import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useTRPC } from "@/lib/trpc-react"
import type { ProviderSummary } from "../types"
import { ModelPicker } from "../model-picker"

export function TitleModelSettings({
  providers,
}: {
  providers: ProviderSummary[]
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const titleModel = settingsQuery.data?.titleModelConfig ?? null

  const setMut = useMutation(
    trpc.workspace.setInstanceTitleModel.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.getSettings.queryKey(),
        })
      },
      onError: (error) =>
        toast.error(error.message || "Could not update title model"),
    })
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat titles</CardTitle>
        <CardDescription>
          After the first reply, Nibchat can name the chat with this model.
          Rename always wins. If generation fails, the first message is used
          instead. Leave this off to always use the first message.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <ModelPicker
          config={titleModel ?? {}}
          providers={providers}
          successToast="Title model updated"
          onChange={async (config) => {
            if (!config.providerId || !config.model) return
            await setMut.mutateAsync({
              providerId: config.providerId,
              model: config.model,
            })
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!titleModel || setMut.isPending}
          onClick={() => {
            setMut.mutate(null, {
              onSuccess: () => toast.success("Title model turned off"),
            })
          }}
        >
          Off
        </Button>
      </CardContent>
    </Card>
  )
}
