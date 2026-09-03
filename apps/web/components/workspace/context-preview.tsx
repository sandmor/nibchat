"use client"

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  assembleContextPreview,
  formatCompactNumber,
  formatCompactSegments,
  mergeDraftSummary,
  TOKEN_ESTIMATE_TOOLTIP,
  type AssembledContextPreviewData,
  type ContextPreviewLayer,
  type ContextPreviewOverlay,
} from "@/lib/context-preview"
import { buildMcpInstructionsText } from "@/lib/mcp-instructions"
import { parseProviderModelsJson } from "@/lib/provider-models"
import { replayReasoningEnabled } from "@/lib/reasoning-replay"
import { useTRPC } from "@/lib/trpc-react"
import type { NodeRow } from "@/lib/types"
import type { ComposerDraft } from "./conversation-session-store"
import { useBrowserTimeZone, useMediaMdUp } from "./hooks"

export type { AssembledContextPreviewData }

type PreviewModelConfig = {
  providerId?: string
  model?: string
  replayReasoning?: boolean
}

type PreviewProviderKind = {
  id: string
  kind: string
  models_json: string
}

type ContextPreviewGraph = {
  nodes: NodeRow[]
  chatStackId: string | null
  draftStackId: string | null
  hasChat: boolean
  modelConfig: PreviewModelConfig
  providers: ReadonlyArray<PreviewProviderKind>
}

const ContextPreviewGraphContext = createContext<ContextPreviewGraph | null>(
  null
)

export function ContextPreviewProvider({
  nodes,
  chatStackId,
  draftStackId,
  hasChat,
  modelConfig,
  providers,
  children,
}: ContextPreviewGraph & { children: ReactNode }) {
  const providerId = modelConfig.providerId
  const model = modelConfig.model
  const replayReasoning = modelConfig.replayReasoning
  const value = useMemo(
    () => ({
      nodes,
      chatStackId,
      draftStackId,
      hasChat,
      modelConfig: { providerId, model, replayReasoning },
      providers,
    }),
    [
      nodes,
      chatStackId,
      draftStackId,
      hasChat,
      providerId,
      model,
      replayReasoning,
      providers,
    ]
  )
  return (
    <ContextPreviewGraphContext.Provider value={value}>
      {children}
    </ContextPreviewGraphContext.Provider>
  )
}

function useContextPreviewGraph() {
  const graph = useContext(ContextPreviewGraphContext)
  if (!graph) {
    throw new Error("ContextPreviewProvider is required")
  }
  return graph
}

const HYDRATION_PREVIEW_NOW = new Date(0)

function useAssembledContextPreview(
  contextParentId: string | null,
  refreshedAt: Date | null,
  overlay?: ContextPreviewOverlay
) {
  const graph = useContextPreviewGraph()
  const trpc = useTRPC()
  const timeZone = useBrowserTimeZone()
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const surfacesQuery = useQuery(
    trpc.workspace.listApprovedMcpSurfaces.queryOptions()
  )

  return useMemo(() => {
    const provider = graph.providers.find(
      (item) => item.id === graph.modelConfig.providerId
    )
    const pdfInputMode =
      provider && graph.modelConfig.model
        ? (parseProviderModelsJson(provider.models_json).find(
            (model) => model.id === graph.modelConfig.model
          )?.pdfInput ?? "extracted")
        : "extracted"
    const mcpServerInstructionsText = buildMcpInstructionsText(
      (surfacesQuery.data ?? []).map((surface) => ({
        name: surface.profileName,
        instructions: surface.instructions,
      }))
    )
    return assembleContextPreview({
      nodes: graph.nodes,
      contextParentId,
      chatStackId: graph.hasChat ? graph.chatStackId : graph.draftStackId,
      defaultStackId: settingsQuery.data?.defaultPromptStackId ?? null,
      stacks: settingsQuery.data?.promptStacks ?? [],
      replayReasoning: replayReasoningEnabled(
        provider?.kind,
        graph.modelConfig.replayReasoning
      ),
      pdfInputMode,
      mcpServerInstructionsText,
      timeZone: timeZone ?? undefined,
      now: timeZone ? (refreshedAt ?? new Date()) : HYDRATION_PREVIEW_NOW,
      overlay,
    })
  }, [
    graph,
    contextParentId,
    overlay,
    refreshedAt,
    settingsQuery.data,
    surfacesQuery.data,
    timeZone,
  ])
}

const LAYER_BAR_CLASS: Record<ContextPreviewLayer["id"], string> = {
  stack: "bg-muted-foreground/40",
  path: "bg-foreground/75",
  draft: "bg-primary",
}

function layerCaption(layer: ContextPreviewLayer) {
  return `${layer.messageCount} ${
    layer.messageCount === 1 ? "message" : "messages"
  } · ~${formatCompactNumber(layer.charCount)} chars · ~${formatCompactNumber(
    layer.estimatedTokens
  )} tokens (est.)`
}

function sourceLabel(source: AssembledContextPreviewData["source"]) {
  if (source === "instance") return "Instance default"
  if (source === "chat") return "This chat"
  if (source === "fallback") return "Fallback"
  return "Built-in"
}

function ContextPreviewCompose({
  data,
  draft,
  onRevealMessage,
}: {
  data: AssembledContextPreviewData
  draft?: ComposerDraft
  onRevealMessage?: (nodeId: string) => void
}) {
  const merged = useMemo(
    () =>
      draft
        ? mergeDraftSummary(data.summary, draft, data.pdfInputMode)
        : data.summary,
    [data.summary, data.pdfInputMode, draft]
  )
  const layers = merged.layers.filter(
    (layer) => layer.charCount > 0 || layer.messageCount > 0
  )
  const totalChars = layers.reduce((sum, layer) => sum + layer.charCount, 0)
  const fileCount = merged.attachmentCount - merged.imageCount
  const demotedCount = data.demotedModuleIds.length
  const draftAttachments = draft?.attachments ?? []
  const hasDraft =
    Boolean(draft?.text) ||
    draftAttachments.length > 0 ||
    merged.layers.some((layer) => layer.id === "draft")

  return (
    <div className="space-y-3 text-sm">
      <p className="text-[11px] text-muted-foreground">
        {sourceLabel(data.source)}
        {data.missingStackId ? " · previous stack missing" : ""}
        {` · ~${formatCompactNumber(merged.estimatedTokens)} tokens (est.)`}
      </p>

      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
        {totalChars === 0 ? (
          <div className="h-full w-full bg-muted" />
        ) : (
          layers.map((layer) => (
            <div
              key={layer.id}
              className={cn("h-full min-w-0", LAYER_BAR_CLASS[layer.id])}
              style={{
                width: `${Math.max((layer.charCount / totalChars) * 100, 0)}%`,
              }}
              title={`${layer.label}: ${layerCaption(layer)}`}
            />
          ))
        )}
      </div>
      <ul className="space-y-1 text-[11px] text-muted-foreground">
        {merged.layers.map((layer) => (
          <li key={layer.id} className="flex items-baseline gap-2">
            <span
              className={cn(
                "mt-0.5 size-1.5 shrink-0 rounded-full",
                LAYER_BAR_CLASS[layer.id]
              )}
            />
            <span className="min-w-16 font-medium text-foreground">
              {layer.label}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {layerCaption(layer)}
            </span>
          </li>
        ))}
      </ul>

      {data.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {data.warnings.map((warning, index) => (
            <li key={`${warning.moduleId}-${index}`}>{warning.message}</li>
          ))}
        </ul>
      ) : null}

      {demotedCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {demotedCount === 1
            ? "1 stack module remapped to assistant"
            : `${demotedCount} stack modules remapped to assistant`}
        </p>
      ) : null}

      <Collapsible className="space-y-1">
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md text-left text-xs font-medium text-muted-foreground hover:text-foreground">
          System prompt
          <span className="text-[11px] font-normal">
            {data.system
              ? `~${formatCompactNumber(data.system.length)} chars`
              : "None"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {data.system ? (
            <pre className="rounded-lg border bg-muted/40 p-2 text-xs whitespace-pre-wrap">
              {data.system}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">No system string.</p>
          )}
        </CollapsibleContent>
      </Collapsible>

      {data.excludedMessages.length > 0 ? (
        <section className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Excluded ({data.excludedMessages.length})
          </p>
          <ul className="space-y-1">
            {data.excludedMessages.map((message) => {
              const row = (
                <>
                  <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                    {message.role}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {message.preview || "—"}
                  </span>
                </>
              )
              return (
                <li key={message.id}>
                  {onRevealMessage ? (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted/70"
                      onClick={() => onRevealMessage(message.id)}
                    >
                      {row}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 px-1.5 py-1 text-xs">
                      {row}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {hasDraft ? (
        <p className="text-xs text-muted-foreground">
          Draft
          {draft?.text
            ? ` · ~${formatCompactNumber(draft.text.length)} chars`
            : ""}
          {draftAttachments.length > 0
            ? ` · ${draftAttachments.length} ${
                draftAttachments.length === 1 ? "attachment" : "attachments"
              }`
            : ""}
        </p>
      ) : null}

      {merged.imageCount > 0 || fileCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {merged.imageCount > 0
            ? `${merged.imageCount} ${
                merged.imageCount === 1 ? "image" : "images"
              } (not counted in token estimate)`
            : null}
          {merged.imageCount > 0 && fileCount > 0 ? " · " : null}
          {fileCount > 0
            ? `${fileCount} ${fileCount === 1 ? "file" : "files"} in char count`
            : null}
        </p>
      ) : null}
    </div>
  )
}

const SHEET_CONTENT_CLASS =
  "top-auto right-0 bottom-0 left-0 flex max-h-[min(90dvh,32rem)] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-3 overflow-hidden rounded-t-4xl rounded-b-none p-4"

function ContextPreviewWell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {children}
    </div>
  )
}

export function ContextPreviewDialog({
  open,
  onOpenChange,
  title = "Context",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={SHEET_CONTENT_CLASS}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <ContextPreviewWell>{children}</ContextPreviewWell>
      </DialogContent>
    </Dialog>
  )
}

export function ContextPreviewStrip({
  contextParentId,
  draft,
  overlay,
  streaming,
  onRevealMessage,
}: {
  contextParentId: string | null
  draft?: ComposerDraft
  overlay?: ContextPreviewOverlay
  streaming?: boolean
  onRevealMessage?: (nodeId: string) => void
}) {
  const mdUp = useMediaMdUp()
  const [open, setOpen] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const data = useAssembledContextPreview(contextParentId, refreshedAt, overlay)
  const merged = draft
    ? mergeDraftSummary(data.summary, draft, data.pdfInputMode)
    : data.summary
  const segments = formatCompactSegments(merged)
  const label = segments.map((segment) => segment.text).join(" · ")
  const title = overlay ? "This branch" : "Next send"

  const panel = (
    <ContextPreviewCompose
      data={data}
      draft={overlay ? undefined : draft}
      onRevealMessage={
        onRevealMessage
          ? (nodeId) => {
              setOpen(false)
              onRevealMessage(nodeId)
            }
          : undefined
      }
    />
  )

  if (streaming) {
    return (
      <p className="px-2 py-1 text-[11px] text-muted-foreground">Generating…</p>
    )
  }

  const triggerClass =
    "w-full truncate rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"

  function setPreviewOpen(nextOpen: boolean) {
    if (nextOpen) setRefreshedAt(new Date())
    setOpen(nextOpen)
  }

  if (mdUp) {
    return (
      <Popover open={open} onOpenChange={setPreviewOpen}>
        <TooltipProvider delay={400}>
          <WithTooltip label={TOKEN_ESTIMATE_TOOLTIP}>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  className={triggerClass}
                  aria-label="Context preview"
                />
              }
            >
              {label}
            </PopoverTrigger>
          </WithTooltip>
        </TooltipProvider>
        <PopoverContent
          align="start"
          side="top"
          className="flex max-h-[min(24rem,70vh)] w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 overflow-hidden p-3"
        >
          <p className="text-xs font-medium">{title}</p>
          <ContextPreviewWell>{panel}</ContextPreviewWell>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      <button
        type="button"
        className={triggerClass}
        aria-label="Context preview"
        onClick={() => setPreviewOpen(true)}
      >
        {label}
      </button>
      <ContextPreviewDialog
        open={open}
        onOpenChange={setPreviewOpen}
        title={title}
      >
        {panel}
      </ContextPreviewDialog>
    </>
  )
}
