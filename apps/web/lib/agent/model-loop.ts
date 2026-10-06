import {
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai"
import type { GenerationPayload } from "@/lib/generation-streams/events"
import { textFromParts, type Parts } from "@/lib/agent/parts"
import { formatProviderError } from "@/lib/provider-errors"
import type { DiagnosticOperationHandle } from "@/lib/diagnostics"
import {
  instrumentTools,
  type ToolDiagnostics,
} from "@/lib/agent/tool-diagnostics"
import {
  compactModelContext,
  contextCompactionSource,
  type ContextSummaryCache,
} from "@/lib/agent/context-compaction"
import type { ToolInvocationPart } from "@/lib/types"
import type { ModelConfig } from "@/lib/providers"

export function runModelLoop(input: {
  model: LanguageModel
  system: string
  messages: ModelMessage[]
  tools: ToolSet
  maxSteps: number
  abortSignal: AbortSignal
  config: ModelConfig
  appendEvent: (event: GenerationPayload) => Promise<void>
  getParts: () => Parts
  onLiveText?: (text: string) => void
  onStepEnd?: () => Promise<void>
  diagnostic: DiagnosticOperationHandle
  toolDiagnostics: ToolDiagnostics
  onFirstContent?: (elapsedMs: number) => void
  onFinish: (event: {
    usage: unknown
    finishReason: string | undefined
  }) => Promise<void>
  onAbort: () => Promise<void>
  onError: (error: unknown) => Promise<void>
}): ReturnType<typeof streamText> {
  let nextPartId = 0
  const activePartIds = new Map<string, string>()
  const localPartId = (type: "text" | "reasoning", providerId: string) => {
    const key = `${type}\0${providerId}`
    const current = activePartIds.get(key)
    if (current) return current
    const id = `${type}-${++nextPartId}`
    activePartIds.set(key, id)
    return id
  }
  const closePartId = (type: "text" | "reasoning", providerId: string) => {
    activePartIds.delete(`${type}\0${providerId}`)
  }
  const existingTool = (toolCallId: string) =>
    input
      .getParts()
      .find(
        (part): part is ToolInvocationPart =>
          part.type === "tool-invocation" && part.toolCallId === toolCallId
      )
  const summaryCache: ContextSummaryCache = { source: "", summary: "" }
  const startedAt = Date.now()
  let firstContent = false
  return streamText({
    model: input.model,
    system: input.system,
    allowSystemInMessages: true,
    messages: input.messages,
    tools: instrumentTools(input.tools, input.toolDiagnostics),
    stopWhen: Number.isFinite(input.maxSteps)
      ? stepCountIs(input.maxSteps)
      : () => false,
    prepareStep: async ({ messages }) => {
      try {
        const source = contextCompactionSource(messages)
        if (source === null) return undefined
        const compacted = await compactModelContext({
          model: input.model,
          messages,
          abortSignal: input.abortSignal,
          cache: summaryCache,
          source,
        })
        return compacted ? { messages: compacted } : undefined
      } catch (error) {
        if (!input.abortSignal.aborted)
          await input.diagnostic.warn(
            "compaction_failed",
            { phase: "context" },
            error
          )
        return undefined
      }
    },
    abortSignal: input.abortSignal,
    temperature: input.config.temperature,
    maxOutputTokens: input.config.maxOutputTokens,
    topP: input.config.topP,
    frequencyPenalty: input.config.frequencyPenalty,
    presencePenalty: input.config.presencePenalty,
    stopSequences: input.config.stopSequences,
    providerOptions: input.config.providerOptions as never,
    onChunk: async ({ chunk }) => {
      if (
        !firstContent &&
        (chunk.type === "text-delta" || chunk.type === "reasoning-delta") &&
        chunk.text.length > 0
      ) {
        firstContent = true
        input.onFirstContent?.(Date.now() - startedAt)
      }
      if (chunk.type === "text-start") {
        const providerMetadata = chunk.providerMetadata as
          | Record<string, unknown>
          | undefined
        const id = localPartId("text", chunk.id)
        await input.appendEvent({
          type: "text-start",
          id,
          ...(providerMetadata ? { providerMetadata } : {}),
        })
      }
      if (chunk.type === "text-delta") {
        const providerMetadata = chunk.providerMetadata as
          | Record<string, unknown>
          | undefined
        await input.appendEvent({
          type: "text-delta",
          id: localPartId("text", chunk.id),
          delta: chunk.text,
          ...(providerMetadata ? { providerMetadata } : {}),
        })
        input.onLiveText?.(textFromParts(input.getParts()))
      }
      if (chunk.type === "text-end") {
        const providerMetadata = chunk.providerMetadata as
          | Record<string, unknown>
          | undefined
        const id = localPartId("text", chunk.id)
        await input.appendEvent({
          type: "text-end",
          id,
          ...(providerMetadata ? { providerMetadata } : {}),
        })
        closePartId("text", chunk.id)
        input.onLiveText?.(textFromParts(input.getParts()))
      }
      if (chunk.type === "reasoning-start") {
        const providerMetadata = chunk.providerMetadata as
          | Record<string, unknown>
          | undefined
        const id = localPartId("reasoning", chunk.id)
        await input.appendEvent({
          type: "reasoning-start",
          id,
          ...(providerMetadata ? { providerMetadata } : {}),
        })
      }
      if (chunk.type === "reasoning-delta") {
        const providerMetadata = chunk.providerMetadata as
          | Record<string, unknown>
          | undefined
        await input.appendEvent({
          type: "reasoning-delta",
          id: localPartId("reasoning", chunk.id),
          delta: chunk.text,
          ...(providerMetadata ? { providerMetadata } : {}),
        })
      }
      if (chunk.type === "reasoning-end") {
        const providerMetadata = chunk.providerMetadata as
          | Record<string, unknown>
          | undefined
        const id = localPartId("reasoning", chunk.id)
        await input.appendEvent({
          type: "reasoning-end",
          id,
          ...(providerMetadata ? { providerMetadata } : {}),
        })
        closePartId("reasoning", chunk.id)
      }
      if (chunk.type === "tool-input-start") {
        const tool = {
          type: "tool-invocation",
          toolCallId: chunk.id,
          toolName: chunk.toolName,
          state: "input-streaming",
          input: {},
          providerMetadata: chunk.providerMetadata as
            | Record<string, unknown>
            | undefined,
        } satisfies ToolInvocationPart
        await input.appendEvent({ type: "tool-upsert", tool })
      }
      if (chunk.type === "tool-call") {
        if (
          input.tools[chunk.toolName] &&
          !input.tools[chunk.toolName]?.execute
        )
          await input.diagnostic.event("tool.requested", "info", {
            toolName: chunk.toolName,
            toolCallId: chunk.toolCallId,
            source: "client",
            outcome: "awaiting_input",
          })
        const tool = {
          type: "tool-invocation",
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          state: "input-available",
          input: chunk.input,
          providerMetadata: (
            chunk as { providerMetadata?: Record<string, unknown> }
          ).providerMetadata,
        } satisfies ToolInvocationPart
        await input.appendEvent({ type: "tool-upsert", tool })
      }
      if (chunk.type === "tool-result") {
        const existing = existingTool(chunk.toolCallId)
        const tool = {
          type: "tool-invocation",
          toolCallId: chunk.toolCallId,
          toolName: existing?.toolName ?? chunk.toolName,
          state: "output-available",
          input: existing?.input ?? chunk.input ?? {},
          output: chunk.output,
          metadata: existing?.metadata,
          providerMetadata:
            (chunk as { providerMetadata?: Record<string, unknown> })
              .providerMetadata ?? existing?.providerMetadata,
        } satisfies ToolInvocationPart
        await input.appendEvent({ type: "tool-upsert", tool })
      }
      if (chunk.type === "tool-error") {
        const existing = existingTool(chunk.toolCallId)
        const errorText = formatProviderError(chunk.error)
        await input.toolDiagnostics.validationFailure(
          chunk.toolName,
          chunk.toolCallId,
          chunk.error
        )
        const tool = {
          type: "tool-invocation",
          toolCallId: chunk.toolCallId,
          toolName: existing?.toolName ?? chunk.toolName,
          state: "output-error",
          input: existing?.input ?? chunk.input ?? {},
          errorText,
          metadata: existing?.metadata,
          providerMetadata:
            (chunk as { providerMetadata?: Record<string, unknown> })
              .providerMetadata ?? existing?.providerMetadata,
        } satisfies ToolInvocationPart
        await input.appendEvent({ type: "tool-upsert", tool })
      }
    },
    onFinish: async ({ usage, finishReason }) => {
      await input.onFinish({ usage, finishReason })
    },
    onStepEnd: async () => {
      await input.onStepEnd?.()
    },
    onAbort: async () => {
      await input.onAbort()
    },
    onError: async ({ error }) => {
      await input.onError(error)
    },
  })
}
