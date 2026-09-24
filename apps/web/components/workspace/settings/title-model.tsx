"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
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
import { Textarea } from "@/components/ui/textarea"
import { DEFAULT_TITLE_INSTRUCTIONS } from "@/lib/chat-settings/catalog"
import type { TitleSettings } from "@/lib/chat-settings"
import { catalogModelLabel } from "@/lib/provider-models"
import { useTRPC } from "@/lib/trpc-react"
import type { ProviderSummary } from "../types"
import { ModelPicker } from "../model-picker"

function modelLabel(
  providers: ProviderSummary[],
  model: TitleSettings["titleModel"]
) {
  const found = catalogModelLabel(providers, model)
  if (!found) return "No model"
  return found.providerName
    ? `${found.providerName} ${found.modelLabel}`
    : found.modelLabel
}

function TitleFields({
  value,
  inherited,
  onChange,
  providers,
  disabled,
}: {
  value: TitleSettings
  inherited?: TitleSettings
  onChange: (value: TitleSettings) => void | Promise<unknown>
  providers: ProviderSummary[]
  disabled: boolean
}) {
  const [instructions, setInstructions] = useState(
    value.titleInstructions ?? ""
  )
  const [editingInstructions, setEditingInstructions] = useState(false)
  const strategy =
    value.titleStrategy ?? (inherited ? "inherit" : "first-message")
  const resolvedStrategy =
    value.titleStrategy ?? inherited?.titleStrategy ?? "first-message"
  const model = value.titleModel ?? inherited?.titleModel
  const inheritedInstructions =
    inherited?.titleInstructions ?? DEFAULT_TITLE_INSTRUCTIONS
  const instructionPreview = (value.titleInstructions ?? inheritedInstructions)
    .replace(/\s+/g, " ")
    .slice(0, 80)
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Strategy</Label>
        <Select
          value={strategy}
          onValueChange={(next) =>
            onChange({
              ...value,
              titleStrategy:
                next === "inherit"
                  ? undefined
                  : (next as "first-message" | "generate"),
            })
          }
        >
          <SelectTrigger aria-label="Title strategy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {inherited && (
              <SelectItem value="inherit">
                Inherit ({inherited.titleStrategy ?? "first-message"})
              </SelectItem>
            )}
            <SelectItem value="first-message">First message</SelectItem>
            <SelectItem value="generate">Generate with a model</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {resolvedStrategy === "generate" && (
        <div className="flex flex-wrap items-center gap-2">
          <ModelPicker
            config={model ?? {}}
            providers={providers}
            successToast="Title model updated"
            onChange={async (config) => {
              if (!config.providerId || !config.model) return
              await onChange({
                ...value,
                titleModel: {
                  providerId: config.providerId,
                  model: config.model,
                },
              })
            }}
          />
          {value.titleModel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onChange({ ...value, titleModel: undefined })}
            >
              {inherited ? "Inherit model" : "Clear model"}
            </Button>
          )}
          {inherited && !value.titleModel && (
            <span className="text-xs text-muted-foreground">
              {modelLabel(providers, inherited.titleModel)}
            </span>
          )}
        </div>
      )}
      <div className="space-y-2">
        <Label
          htmlFor={
            inherited
              ? "personal-title-instructions"
              : "admin-title-instructions"
          }
        >
          Instructions
        </Label>
        {editingInstructions ? (
          <Textarea
            id={
              inherited
                ? "personal-title-instructions"
                : "admin-title-instructions"
            }
            value={instructions}
            autoFocus
            onChange={(event) => setInstructions(event.target.value)}
            onBlur={() => {
              setEditingInstructions(false)
              const next = instructions.trim()
              if (next !== (value.titleInstructions ?? ""))
                onChange({ ...value, titleInstructions: next || undefined })
            }}
          />
        ) : (
          <button
            type="button"
            id={
              inherited
                ? "personal-title-instructions"
                : "admin-title-instructions"
            }
            className="rounded-lg border px-3 py-2 text-left text-sm text-muted-foreground"
            onClick={() => {
              setInstructions(value.titleInstructions ?? "")
              setEditingInstructions(true)
            }}
          >
            {instructionPreview || "Add instructions"}
          </button>
        )}
        {inherited && value.titleInstructions && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange({ ...value, titleInstructions: undefined })}
          >
            Inherit instructions
          </Button>
        )}
      </div>
    </div>
  )
}

export function TitleModelSettings({
  providers,
  isOwner,
}: {
  providers: ProviderSummary[]
  isOwner: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const admin = settingsQuery.data?.adminTitleSettings ?? {}
  const user = settingsQuery.data?.userTitleSettings ?? {}
  const refresh = () =>
    queryClient.invalidateQueries(trpc.workspace.getSettings.queryFilter())
  const adminMut = useMutation(
    trpc.workspace.setAdminTitleSettings.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(error.message),
    })
  )
  const userMut = useMutation(
    trpc.workspace.setUserTitleSettings.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(error.message),
    })
  )
  return (
    <>
      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Default chat titles</CardTitle>
            <CardDescription>
              Baseline for everyone. Models are limited to the enabled catalog.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TitleFields
              key={JSON.stringify(admin)}
              value={admin}
              providers={providers}
              disabled={adminMut.isPending}
              onChange={(next) => adminMut.mutateAsync(next)}
            />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>My chat titles</CardTitle>
          <CardDescription>
            Leave a field unset to inherit the admin default. Spaces can refine
            these choices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TitleFields
            key={JSON.stringify(user)}
            value={user}
            inherited={admin}
            providers={providers}
            disabled={userMut.isPending}
            onChange={(next) => userMut.mutateAsync(next)}
          />
        </CardContent>
      </Card>
    </>
  )
}
