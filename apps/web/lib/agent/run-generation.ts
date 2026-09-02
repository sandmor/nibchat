import { stepCountIs, streamText, type LanguageModel } from "ai"
import { generationStreamStore } from "@/lib/generation-streams/default-port"
import { generationExecutor } from "@/lib/generation-streams/default-port"
import { generationSseResponse } from "@/lib/generation-streams/http"
import {
  reduceGenerationPayload,
  type GenerationPayload,
} from "@/lib/generation-streams/events"
import type { GenerationProducer } from "@/lib/generation-streams/ports"
import { startProducerGuards } from "@/lib/generation-streams/producer-session"
import { activateGenerationRun } from "@/lib/generation-runs"
import { buildEmbeddedModelMessages } from "@/lib/agent/build-messages-embed"
import {
  partsHavePendingClientTools,
  resolveStreamTerminalOutcome,
  type Parts,
} from "@/lib/agent/parts"
import { reservedBuiltInToolNames, selectNibchatTools } from "@/lib/agent/tools"
import { getBuiltInToolsPrefs } from "@/lib/user-settings"
import {
  beginResumeAssistant,
  finalizeStreamingAssistantWithSnapshot,
  restoreAwaitingInput,
} from "@/lib/chat-service"
import { ancestorPath, parseJson } from "@/lib/domain"
import {
  registerGeneration,
  unregisterGeneration,
} from "@/lib/active-generations"
import { formatProviderError } from "@/lib/provider-errors"
import {
  canReplayReasoning,
  pdfInputModeFor,
  type ModelConfig,
  type ResponsesReplayTarget,
} from "@/lib/providers"
import {
  assemblePromptContext,
  type PromptStackDocument,
} from "@/lib/prompt-stack"
import { idleSinceFromPath, normalizeTimeZone } from "@/lib/prompt-macros"
import { prepareMcpTools } from "@/lib/mcp"
import { assertPdfFallbackAvailable } from "@/lib/pdf-input"
import type { NodeRow, ToolInvocationPart } from "@/lib/types"

const MAX_STEPS = 20

function withoutTransientStreamIds(parts: Parts): Parts {
  return parts.map((part) => {
    if (part.type !== "text" && part.type !== "reasoning") return part
    const persisted = { ...part }
    delete persisted.streamId
    return persisted
  }) as Parts
}

export class ResumeClaimError extends Error {
  constructor(
    public readonly kind: "missing" | "superseded",
    message: string
  ) {
    super(message)
    this.name = "ResumeClaimError"
  }
}

export type GenerationSetup = {
  userId: string
  assistant: NodeRow
  /** Context ends at this node (inclusive). */
  contextLeafId: string | null
  /** Base parts already on the assistant (resume after tools). */
  seedParts?: Parts
  config: ModelConfig
  languageModel: LanguageModel
  responsesReplay?: ResponsesReplayTarget
  selectedProtocol?: () => string | undefined
  rememberProtocol?: (protocol: string) => Promise<void>
  promptStack: PromptStackDocument
  /** Browser IANA time zone supplied for prompt macro expansion. */
  timeZone: string
  requestSignal: AbortSignal
  allNodes: NodeRow[]
  previousMetadata?: Record<string, unknown>
  /**
   * When set, claim awaiting_input → streaming with seedParts inside the
   * generation runner, and restore originalParts if setup fails before the
   * stream response is returned.
   */
  resumeClaim?: {
    originalParts: Parts
  }
  /**
   * Started after the assistant row is persisted. Not awaited, so extra work
   * (chat titles) cannot stall the stream.
   */
  afterFinalize?: (input: {
    outcome: "complete" | "awaiting_input" | "aborted" | "error"
    parts: Parts
  }) => Promise<void>
  generationId: string
}

/**
 * Run streamText with nibchat tools, stream UI events to the client, and persist
 * terminal parts (complete | awaiting_input | stopped | error).
 */
export async function createGenerationResponse(
  setup: GenerationSetup,
  headers: Record<string, string>
): Promise<Response> {
  const {
    userId,
    assistant,
    contextLeafId,
    seedParts = [],
    config,
    languageModel,
    responsesReplay,
    selectedProtocol,
    rememberProtocol,
    promptStack,
    timeZone,
    requestSignal,
    allNodes,
    previousMetadata,
    resumeClaim,
    afterFinalize,
    generationId,
  } = setup

  const generation = new AbortController()
  registerGeneration(assistant.id, generation)
  let registered = true
  const dropRegistration = () => {
    if (!registered) return
    unregisterGeneration(assistant.id)
    registered = false
  }

  let claimSucceeded = false
  let producerHandle: GenerationProducer | null = null
  let producerGuards: { stop: () => void } | null = null
  let terminalPublished = false
  const publishTerminal = async (terminal: {
    result:
      | "complete"
      | "awaiting_input"
      | "stopped"
      | "deleted"
      | "error"
      | "missing"
      | "superseded"
    node: NodeRow | null
  }) => {
    if (!producerHandle || terminalPublished) return
    await generationStreamStore.complete(producerHandle, {
      type: "terminal",
      ...terminal,
    })
    terminalPublished = true
  }

  const respond = (body: Response) => {
    const withHeaders = new Headers(body.headers)
    for (const [k, v] of Object.entries(headers)) withHeaders.set(k, v)
    withHeaders.set("X-Accel-Buffering", "no")
    withHeaders.set("X-Nibchat-Assistant-Node", assistant.id)
    withHeaders.set("X-Nibchat-Generation-Id", generationId)
    return new Response(body.body, {
      status: body.status,
      statusText: body.statusText,
      headers: withHeaders,
    })
  }

  try {
    if (resumeClaim) {
      const claim = await beginResumeAssistant(
        assistant.id,
        seedParts,
        generationId
      )
      if (claim === "missing")
        throw new ResumeClaimError("missing", "Node not found")
      if (claim === "superseded")
        throw new ResumeClaimError(
          "superseded",
          "Assistant is no longer awaiting input."
        )
      claimSucceeded = true
    }

    // Open before prompt/MCP preparation so other clients see a pending,
    // durable stream rather than an empty successful attachment.
    producerHandle = await generationStreamStore.open({
      generationId,
      nodeId: assistant.id,
      chatId: assistant.chat_id,
      parentNodeId: assistant.parent_id,
    })
    producerGuards = startProducerGuards(
      generationStreamStore,
      producerHandle,
      () => generation.abort()
    )
    await generationStreamStore.append(producerHandle, {
      type: "parts-snapshot",
      parts: seedParts,
    })
    if (!(await activateGenerationRun(generationId))) {
      generation.abort()
      const terminal = await finalizeStreamingAssistantWithSnapshot({
        nodeId: assistant.id,
        generationId,
        outcome: "aborted",
        parts: seedParts,
        previousMetadata: {
          ...parseJson<Record<string, unknown>>(assistant.metadata_json, {}),
          ...(previousMetadata ?? {}),
        },
      })
      await publishTerminal(terminal).catch((error) =>
        console.warn("[nibchat/generation-terminal]", error)
      )
      producerGuards.stop()
      producerGuards = null
      if (!terminalPublished) await generationStreamStore.close(producerHandle)
      dropRegistration()
      return respond(
        generationSseResponse(
          generationStreamStore.subscribe(generationId, null, requestSignal)
        )
      )
    }

    // Prefer post-claim node parts for resume context leaf rebuild.
    const nodesForContext =
      claimSucceeded && resumeClaim
        ? allNodes.map((n) =>
            n.id === assistant.id
              ? {
                  ...n,
                  parts_json: JSON.stringify(seedParts),
                  status: "streaming" as const,
                }
              : n
          )
        : allNodes

    const contextNodes = contextLeafId
      ? ancestorPath(nodesForContext, contextLeafId)
      : []
    const replayReasoning = await canReplayReasoning(userId, config)
    const pdfInputMode = await pdfInputModeFor(userId, config)
    if (pdfInputMode === "extracted")
      assertPdfFallbackAvailable(
        contextNodes.flatMap((node) => parseJson<Parts>(node.parts_json, []))
      )
    const pathMessages = await buildEmbeddedModelMessages({
      nodes: contextNodes,
      replayReasoning,
      responsesReplay,
      pdfInputMode,
    })
    const mcpServerInstructionsEnabled = promptStack.modules.some(
      (module) => module.kind === "mcp-instructions" && module.enabled
    )
    // Tools always register from global MCP profiles; this stack module only
    // injects server initialize instructions (if any) at its stack position.
    const [mcp, builtInPrefs] = await Promise.all([
      prepareMcpTools({
        includeInstructionsText: mcpServerInstructionsEnabled,
        reservedToolNames: reservedBuiltInToolNames,
      }),
      getBuiltInToolsPrefs(userId),
    ])
    const builtInTools = selectNibchatTools(builtInPrefs.disabled)
    for (const warning of mcp.warnings ?? [])
      console.warn("[nibchat/mcp]", warning)
    const { system: systemPrompt, messages } = assemblePromptContext({
      stack: promptStack,
      pathMessages,
      mcpServerInstructionsText: mcp.instructionsText,
      macroContext: {
        now: new Date(),
        timeZone: normalizeTimeZone(timeZone),
        idleSince: idleSinceFromPath(contextNodes),
      },
    })

    let orderedParts: Parts = [...seedParts]
    let nextPartId = 0
    const activePartIds = new Map<string, string>()
    let settled = false
    // HTTP readers are subscribers only. Explicit server-side cancellation is
    // the sole signal that may stop the provider request.
    const abortSignal = generation.signal

    const appendEvent = async (event: GenerationPayload) => {
      if (!producerHandle) throw new Error("Generation stream was not opened")
      orderedParts = reduceGenerationPayload(orderedParts, event)
      await generationStreamStore.append(producerHandle, event)
    }
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
    const cancellationWasRequested = async () => {
      if (generation.signal.aborted) return true
      try {
        return await generationStreamStore.isCancelled(generationId)
      } catch (error) {
        console.warn("[nibchat/generation-cancel-check]", error)
        return false
      }
    }

    const finalizeOnce = async (
      outcome: "complete" | "awaiting_input" | "aborted" | "error",
      payload: {
        usage?: unknown
        finishReason?: string
        error?: string
      } = {}
    ) => {
      if (settled) return
      settled = true
      let parts = withoutTransientStreamIds(orderedParts)
      const resolved = resolveStreamTerminalOutcome(outcome, parts)
      if (resolved === "complete" && parts.length === 0) {
        parts = [{ type: "text", text: "" }]
      }
      const terminal = await finalizeStreamingAssistantWithSnapshot({
        nodeId: assistant.id,
        generationId,
        outcome: resolved,
        parts,
        usage: payload.usage,
        finishReason: payload.finishReason,
        error: payload.error,
        config,
        previousMetadata: {
          ...parseJson<Record<string, unknown>>(assistant.metadata_json, {}),
          ...(previousMetadata ?? {}),
          ...(responsesReplay
            ? {
                responsesProviderOptionsKey: responsesReplay.providerOptionsKey,
              }
            : {}),
          ...(selectedProtocol?.()
            ? { providerProtocol: selectedProtocol() }
            : {}),
        },
      })
      await publishTerminal(terminal).catch((error) =>
        console.warn("[nibchat/generation-terminal]", error)
      )
      if (
        rememberProtocol &&
        (resolved === "complete" || resolved === "awaiting_input") &&
        selectedProtocol?.()
      )
        void rememberProtocol(selectedProtocol()!).catch((error) =>
          console.warn("[nibchat/protocol-learning]", error)
        )
      if (afterFinalize) {
        void afterFinalize({ outcome: resolved, parts }).catch((error) => {
          console.warn("[nibchat/generation]", error)
        })
      }
    }

    const result = streamText({
      model: languageModel,
      system: systemPrompt,
      messages,
      tools: { ...mcp.tools, ...builtInTools },
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      stopSequences: config.stopSequences,
      providerOptions: config.providerOptions as never,
      onChunk: async ({ chunk }) => {
        if (chunk.type === "text-start") {
          const providerMetadata = chunk.providerMetadata as
            | Record<string, unknown>
            | undefined
          const id = localPartId("text", chunk.id)
          await appendEvent({
            type: "text-start",
            id,
            ...(providerMetadata ? { providerMetadata } : {}),
          })
        }
        if (chunk.type === "text-delta") {
          const providerMetadata = chunk.providerMetadata as
            | Record<string, unknown>
            | undefined
          await appendEvent({
            type: "text-delta",
            id: localPartId("text", chunk.id),
            delta: chunk.text,
            ...(providerMetadata ? { providerMetadata } : {}),
          })
        }
        if (chunk.type === "text-end") {
          const providerMetadata = chunk.providerMetadata as
            | Record<string, unknown>
            | undefined
          const id = localPartId("text", chunk.id)
          await appendEvent({
            type: "text-end",
            id,
            ...(providerMetadata ? { providerMetadata } : {}),
          })
          closePartId("text", chunk.id)
        }
        if (chunk.type === "reasoning-start") {
          const providerMetadata = chunk.providerMetadata as
            | Record<string, unknown>
            | undefined
          const id = localPartId("reasoning", chunk.id)
          await appendEvent({
            type: "reasoning-start",
            id,
            ...(providerMetadata ? { providerMetadata } : {}),
          })
        }
        if (chunk.type === "reasoning-delta") {
          const providerMetadata = chunk.providerMetadata as
            | Record<string, unknown>
            | undefined
          await appendEvent({
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
          await appendEvent({
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
          await appendEvent({ type: "tool-upsert", tool })
        }
        if (chunk.type === "tool-call") {
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
          await appendEvent({ type: "tool-upsert", tool })
        }
        if (chunk.type === "tool-result") {
          const existing = orderedParts.find(
            (p): p is ToolInvocationPart =>
              p.type === "tool-invocation" && p.toolCallId === chunk.toolCallId
          )
          const tool = {
            type: "tool-invocation",
            toolCallId: chunk.toolCallId,
            toolName: existing?.toolName ?? chunk.toolName,
            state: "output-available",
            input: existing?.input ?? chunk.input ?? {},
            output: chunk.output,
            providerMetadata:
              (chunk as { providerMetadata?: Record<string, unknown> })
                .providerMetadata ?? existing?.providerMetadata,
          } satisfies ToolInvocationPart
          await appendEvent({ type: "tool-upsert", tool })
        }
        if (chunk.type === "tool-error") {
          const existing = orderedParts.find(
            (p): p is ToolInvocationPart =>
              p.type === "tool-invocation" && p.toolCallId === chunk.toolCallId
          )
          const errorText = formatProviderError(chunk.error)
          console.warn("[nibchat/mcp-tool]", chunk.toolName, errorText)
          const tool = {
            type: "tool-invocation",
            toolCallId: chunk.toolCallId,
            toolName: existing?.toolName ?? chunk.toolName,
            state: "output-error",
            input: existing?.input ?? chunk.input ?? {},
            errorText,
            providerMetadata:
              (chunk as { providerMetadata?: Record<string, unknown> })
                .providerMetadata ?? existing?.providerMetadata,
          } satisfies ToolInvocationPart
          await appendEvent({ type: "tool-upsert", tool })
        }
      },
      onFinish: async ({ usage, finishReason }) => {
        try {
          // Prefer awaiting_input when tools are pending even if the tab
          // disconnected (abortSignal set) after the model finished the step.
          if (partsHavePendingClientTools(orderedParts)) {
            await finalizeOnce("awaiting_input", { usage, finishReason })
            return
          }
          if (abortSignal.aborted) return
          await finalizeOnce("complete", { usage, finishReason })
        } finally {
          dropRegistration()
        }
      },
      onAbort: async () => {
        try {
          // Flush partials first; if we already have a full client tool call,
          // park as awaiting_input instead of stopped.
          await finalizeOnce("aborted")
        } finally {
          dropRegistration()
        }
      },
      onError: async ({ error }) => {
        try {
          if (await cancellationWasRequested()) {
            generation.abort()
            await finalizeOnce("aborted")
            return
          }
          console.error("[nibchat/stream]", error)
          await appendEvent({
            type: "error",
            errorText: formatProviderError(error),
          }).catch(() => {})
          await finalizeOnce("error", {
            error: formatProviderError(error),
          })
        } finally {
          dropRegistration()
        }
      },
    })

    generationExecutor.execute({
      generationId,
      nodeId: assistant.id,
      run: async () => {
        if (!producerHandle) throw new Error("Generation stream was not opened")
        try {
          await result.consumeStream()
        } catch (error) {
          // A remote cancellation can make append reject before the producer
          // guard's next poll aborts this local controller. Check before
          // aborting locally so that failure still persists as stopped.
          const cancelled = await cancellationWasRequested()
          generation.abort()
          if (!cancelled && producerHandle)
            await generationStreamStore
              .append(producerHandle, {
                type: "error",
                errorText: formatProviderError(error),
              })
              .catch(() => {})
          await finalizeOnce(
            cancelled ? "aborted" : "error",
            cancelled ? {} : { error: formatProviderError(error) }
          )
        } finally {
          producerGuards?.stop()
          producerGuards = null
          // Terminal assistant persistence is performed by the AI SDK callbacks
          // above before its provider stream completes.
          if (producerHandle && !terminalPublished)
            await generationStreamStore.close(producerHandle)
        }
      },
    })

    return respond(
      generationSseResponse(
        generationStreamStore.subscribe(generationId, null, requestSignal)
      )
    )
  } catch (error) {
    if (claimSucceeded && resumeClaim) {
      try {
        await restoreAwaitingInput(
          assistant.id,
          resumeClaim.originalParts,
          generationId
        )
      } catch (restoreError) {
        console.error("[nibchat/stream] restoreAwaitingInput", restoreError)
      }
    }
    if (!claimSucceeded) {
      try {
        const terminal = await finalizeStreamingAssistantWithSnapshot({
          nodeId: assistant.id,
          generationId,
          outcome: "error",
          parts: seedParts,
          error: formatProviderError(error),
        })
        await publishTerminal(terminal).catch((terminalError) =>
          console.warn("[nibchat/generation-terminal]", terminalError)
        )
      } catch (finalizeError) {
        console.error("[nibchat/stream] setup finalization", finalizeError)
      }
    }
    dropRegistration()
    producerGuards?.stop()
    if (producerHandle && !terminalPublished)
      await generationStreamStore.close(producerHandle).catch(() => {})
    throw error
  }
}
