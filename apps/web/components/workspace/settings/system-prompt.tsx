"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useTRPC } from "@/lib/trpc-react"
import { useMutation, useQuery } from "@tanstack/react-query"

export function SystemPromptSettings() {
  const trpc = useTRPC()
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const [draft, setDraft] = useState<string | null>(null)
  const prompt = draft ?? settingsQuery.data?.system_prompt ?? ""
  const updatePrompt = useMutation(
    trpc.workspace.updateSystemPrompt.mutationOptions({
      onSuccess: async () => {
        toast.success("System prompt saved")
        setDraft(null)
        await settingsQuery.refetch()
      },
      onError: (error) => toast.error(error.message || "Could not save"),
    })
  )
  const loaded = settingsQuery.isSuccess
  return (
    <Card>
      <CardHeader>
        <CardTitle>System prompt</CardTitle>
        <CardDescription>
          Applied to every new generation on this instance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={prompt}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          disabled={!loaded}
          placeholder="You are a helpful assistant…"
        />
        <Button
          onClick={() =>
            updatePrompt.mutate({
              systemPrompt: prompt,
            })
          }
          disabled={!loaded || updatePrompt.isPending}
        >
          Save system prompt
        </Button>
      </CardContent>
    </Card>
  )
}
