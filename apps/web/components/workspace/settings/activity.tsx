"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { MetaLine } from "@/components/ui/inline-separator"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { displayChatTitle } from "@/lib/chat-title"
import { MAX_COLLECTION } from "@/lib/limits"
import { useTRPC } from "@/lib/trpc-react"
import {
  DEFAULT_DIAGNOSTIC_RETENTION_DAYS,
  DIAGNOSTIC_RETENTION_DAYS,
  DIAGNOSTIC_KIND_LABELS,
  DIAGNOSTIC_OUTCOME_LABELS,
  DIAGNOSTIC_EVENT_LABELS,
  type DiagnosticKind,
  type DiagnosticOutcome,
} from "@/lib/diagnostic-contract"
import type { ProviderSummary } from "../types"
import { useActivityHistory } from "./use-activity-history"

const KINDS = Object.entries(DIAGNOSTIC_KIND_LABELS)
const OUTCOMES = Object.entries(DIAGNOSTIC_OUTCOME_LABELS)

const LEVELS = [
  ["info", "Info"],
  ["warn", "Warning"],
  ["error", "Error"],
] as const

const RANGES = [
  ["1", "Last day"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
] as const

type Outcome = DiagnosticOutcome
type Level = (typeof LEVELS)[number][0]

function kindLabel(kind: string) {
  return KINDS.find(([value]) => value === kind)?.[1] ?? kind
}

function eventLabel(event: string) {
  return (
    DIAGNOSTIC_EVENT_LABELS[event as keyof typeof DIAGNOSTIC_EVENT_LABELS] ??
    event
  )
}

function outcomeClass(outcome: string) {
  if (outcome === "error" || outcome === "interrupted")
    return "text-destructive"
  if (outcome === "running" || outcome === "fallback")
    return "font-medium text-foreground"
  return ""
}

function formatDate(value: string) {
  return new Date(value).toLocaleString()
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  const rounded =
    seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds)
  return `${rounded} s`
}

function sinceFromRange(range: string) {
  if (!range) return undefined
  const now = Date.now()
  const minute = now - (now % 60_000)
  return new Date(minute - Number(range) * 86_400_000).toISOString()
}

function textField(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key]
  return typeof value === "string" && value ? value : null
}

function providerLabel(
  providers: ProviderSummary[],
  metadata: Record<string, unknown>
) {
  const id = textField(metadata, "providerId")
  if (!id) return null
  return providers.find((provider) => provider.id === id)?.name ?? id
}

function uniqueDetails(items: Array<string | null>) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!item || seen.has(item)) return false
    seen.add(item)
    return true
  })
}

function detailItems(
  metadata: Record<string, unknown>,
  providers: ProviderSummary[],
  includeOutcome = false
) {
  const httpStatus = metadata.httpStatus
  const usage = metadata.usage as
    | { inputTokens?: number; outputTokens?: number }
    | undefined
  return [
    textField(metadata, "model"),
    providerLabel(providers, metadata),
    textField(metadata, "finishReason"),
    textField(metadata, "toolName"),
    textField(metadata, "errorType"),
    typeof httpStatus === "number" ? String(httpStatus) : null,
    textField(metadata, "errorCode"),
    textField(metadata, "reason")?.replaceAll("_", " ") ?? null,
    textField(metadata, "phase"),
    textField(metadata, "analysisStatus")
      ? `Analysis: ${textField(metadata, "analysisStatus")}`
      : null,
    textField(metadata, "status")?.replaceAll("_", " ") ?? null,
    includeOutcome && textField(metadata, "outcome")
      ? DIAGNOSTIC_OUTCOME_LABELS[metadata.outcome as DiagnosticOutcome]
      : null,
    includeOutcome && typeof metadata.durationMs === "number"
      ? formatDuration(metadata.durationMs)
      : null,
    typeof metadata.modelDurationMs === "number"
      ? `Model: ${formatDuration(metadata.modelDurationMs)}`
      : null,
    typeof metadata.firstContentMs === "number"
      ? `First content: ${formatDuration(metadata.firstContentMs)}`
      : null,
    typeof usage?.inputTokens === "number"
      ? `${usage.inputTokens} input tokens`
      : null,
    typeof usage?.outputTokens === "number"
      ? `${usage.outputTokens} output tokens`
      : null,
  ]
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<readonly [string, string]>
  allLabel: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value || "all"}
        items={{
          all: allLabel,
          ...Object.fromEntries(options),
        }}
        onValueChange={(next) => onChange(!next || next === "all" ? "" : next)}
      >
        <SelectTrigger id={id} size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{allLabel}</SelectItem>
          {options.map(([option, optionLabel]) => (
            <SelectItem key={option} value={option}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function ActivitySettings({
  isOwner,
  chatId: chatIdProp,
  providers,
}: {
  isOwner: boolean
  chatId?: string
  providers: ProviderSummary[]
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  const chatId = chatIdProp ?? ""
  const [kind, setKind] = useState<DiagnosticKind | "">("")
  const [outcome, setOutcome] = useState<Outcome | "">("")
  const [level, setLevel] = useState<Level | "">("")
  const [range, setRange] = useState("")
  const [clearOpen, setClearOpen] = useState(false)
  const since = useMemo(() => sinceFromRange(range), [range])
  const filter = useMemo(
    () => ({
      ...(kind ? { kind } : {}),
      ...(outcome ? { outcome } : {}),
      ...(level ? { level } : {}),
      ...(since ? { since } : {}),
      ...(chatId ? { chatId } : {}),
      limit: MAX_COLLECTION,
    }),
    [kind, outcome, level, since, chatId]
  )
  const streamQuery = useQuery(
    trpc.workspace.activity.streamAvailable.queryOptions()
  )
  const { operations, refresh, loadOlder } = useActivityHistory(
    filter,
    Boolean(streamQuery.data)
  )
  const workspace = useQuery({
    ...trpc.workspace.get.queryOptions({ draft: true }),
    enabled: Boolean(chatId),
  })
  const retention = useQuery(
    trpc.workspace.activity.retentionDays.queryOptions()
  )
  const clearOperation = useMutation(
    trpc.workspace.activity.clear.mutationOptions()
  )
  const retentionOperation = useMutation(
    trpc.workspace.activity.setRetentionDays.mutationOptions()
  )
  useEffect(() => {
    if (window.location.hash !== "#activity") return
    document.getElementById("activity")?.scrollIntoView({ block: "start" })
  }, [chatId])

  const exportHistory = async () => {
    try {
      const rows = await queryClient.fetchQuery(
        trpc.workspace.activity.export.queryOptions({
          ...(chatId ? { chatId } : {}),
          ...(kind ? { kind } : {}),
          ...(outcome ? { outcome } : {}),
          ...(level ? { level } : {}),
          ...(since ? { since } : {}),
        })
      )
      const blob = new Blob(
        rows.map((row) => `${JSON.stringify(row)}\n`),
        { type: "application/x-ndjson" }
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "nibchat-activity.ndjson"
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Could not export activity history")
    }
  }
  const clearHistory = async () => {
    try {
      await clearOperation.mutateAsync()
      queryClient.removeQueries(trpc.workspace.activity.export.queryFilter())
      await queryClient.resetQueries(
        trpc.workspace.activity.list.infiniteQueryFilter()
      )
      setClearOpen(false)
      toast.success("Activity history cleared")
    } catch {
      toast.error("Could not clear activity history")
    }
  }
  const chats = workspace.data?.chats ?? []
  const filteredChat = chatId
    ? chats.find((chat) => chat.id === chatId)
    : undefined
  const chatLabel = !chatId
    ? null
    : workspace.isSuccess && !filteredChat
      ? "Deleted chat"
      : filteredChat
        ? displayChatTitle(filteredChat.title)
        : "This chat"
  const seen = new Set<string>()
  const rows = (operations.data?.pages ?? [])
    .flatMap((page) => page.operations)
    .filter((row) => {
      if (seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })

  return (
    <Card id="activity">
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          Recent operation outcomes. Conversation content and provider request
          bodies are not retained.
          {isOwner ? " This list includes every user on the instance." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            id="activity-kind"
            label="Operation"
            value={kind}
            onChange={(value) => setKind(value as DiagnosticKind | "")}
            options={KINDS}
            allLabel="All"
          />
          <FilterSelect
            id="activity-outcome"
            label="Outcome"
            value={outcome}
            onChange={(value) =>
              setOutcome(
                OUTCOMES.some(([option]) => option === value)
                  ? (value as Outcome)
                  : ""
              )
            }
            options={OUTCOMES}
            allLabel="All"
          />
          <FilterSelect
            id="activity-range"
            label="Date"
            value={range}
            onChange={setRange}
            options={RANGES}
            allLabel="All retained"
          />
          <FilterSelect
            id="activity-level"
            label="Severity"
            value={level}
            onChange={(value) =>
              setLevel(
                LEVELS.some(([option]) => option === value)
                  ? (value as Level)
                  : ""
              )
            }
            options={LEVELS}
            allLabel="All"
          />
        </div>
        {chatLabel ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{chatLabel}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.replace("/settings#activity")}
            >
              Show all activity
            </Button>
          </div>
        ) : null}
        {isOwner ? (
          <div className="space-y-2">
            <Label htmlFor="activity-retention">Keep history</Label>
            <Select
              value={String(
                retention.data ?? DEFAULT_DIAGNOSTIC_RETENTION_DAYS
              )}
              items={Object.fromEntries(
                DIAGNOSTIC_RETENTION_DAYS.map((days) => [
                  String(days),
                  `${days} days`,
                ])
              )}
              disabled={retentionOperation.isPending}
              onValueChange={(value) => {
                if (!value) return
                retentionOperation.mutate(
                  { retentionDays: Number(value) },
                  {
                    onSuccess: () => void retention.refetch(),
                    onError: () =>
                      toast.error("Could not update activity retention"),
                  }
                )
              }}
            >
              <SelectTrigger id="activity-retention" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIAGNOSTIC_RETENTION_DAYS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {days} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refresh}>
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void exportHistory()}
          >
            Download events
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setClearOpen(true)}
          >
            Clear history
          </Button>
        </div>

        {operations.isPending ? (
          <p className="text-sm text-muted-foreground">Loading activity…</p>
        ) : operations.isError ? (
          <p className="text-sm text-destructive">
            Could not load activity. Try refreshing.
          </p>
        ) : rows.length ? (
          <div className="grid gap-2">
            {rows.map((operation) => (
              <OperationRowView
                key={operation.id}
                operation={operation}
                providers={providers}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        )}
        {operations.hasNextPage && !operations.isPlaceholderData ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={operations.isFetching}
            onClick={() =>
              void loadOlder().catch(() =>
                toast.error("Could not load older activity")
              )
            }
          >
            Load older
          </Button>
        ) : null}
      </CardContent>
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isOwner ? "Clear all instance history?" : "Clear your history?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isOwner
                ? "Operation history for every user on this instance will be removed."
                : "Your operation history will be removed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={clearOperation.isPending}
              onClick={() => void clearHistory()}
            >
              Clear history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function OperationRowView({
  operation,
  providers,
}: {
  operation: {
    id: string
    chat_id: string | null
    kind: string
    outcome: string
    started_at: string
    duration_ms: number | null
    metadata: Record<string, unknown>
    events: Array<{
      id: string
      event: string
      level: string
      created_at: string
      metadata: Record<string, unknown>
    }>
  }
  providers: ProviderSummary[]
}) {
  const failure = operation.events.find((event) => event.level === "error")
  const summary = (
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium">
        {kindLabel(operation.kind)}
      </span>
      <span
        className="block text-xs text-muted-foreground"
        suppressHydrationWarning
      >
        <MetaLine
          items={[
            <span key="outcome" className={outcomeClass(operation.outcome)}>
              {OUTCOMES.find(([value]) => value === operation.outcome)?.[1] ??
                operation.outcome}
            </span>,
            formatDate(operation.started_at),
            operation.duration_ms != null
              ? formatDuration(operation.duration_ms)
              : null,
            ...uniqueDetails([
              ...detailItems(operation.metadata, providers),
              ...(failure ? detailItems(failure.metadata, providers) : []),
            ]),
          ]}
        />
      </span>
    </span>
  )
  const expandable = operation.events.length > 0 || Boolean(operation.chat_id)
  if (!expandable)
    return (
      <div className="rounded-lg bg-muted px-3 py-2 text-sm">{summary}</div>
    )

  return (
    <Collapsible className="group/activity rounded-lg bg-muted">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {summary}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-open/activity:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 px-3 pb-3">
          {operation.chat_id ? (
            <Link
              href={`/chat/${encodeURIComponent(operation.chat_id)}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open chat
            </Link>
          ) : null}
          {operation.events.map((event) => (
            <p
              key={event.id}
              className="text-xs text-muted-foreground"
              suppressHydrationWarning
            >
              <MetaLine
                items={[
                  <span key="event" className="text-foreground">
                    {eventLabel(event.event)}
                  </span>,
                  formatDate(event.created_at),
                  event.level === "info"
                    ? null
                    : (LEVELS.find(([value]) => value === event.level)?.[1] ??
                      event.level),
                  ...detailItems(
                    event.metadata,
                    providers,
                    event.event === "tool.finished"
                  ),
                ]}
              />
            </p>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
