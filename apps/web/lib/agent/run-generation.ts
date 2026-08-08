import {
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type LanguageModel,
} from "ai"
import { buildModelMessages } from "@/lib/agent/build-messages"
import {
  partsHavePendingClientTools,
  resolveStreamTerminalOutcome,
  upsertToolInvocation,
  type Parts,
} from "@/lib/agent/parts"
import { nibchatTools } from "@/lib/agent/tools"
import {
  beginResumeAssistant,
  finalizeStreamingAssistant,
  restoreAwaitingInput,
} from "@/lib/chat-service"
import { ancestorPath, parseJson } from "@/lib/domain"
import {
  registerGeneration,
  unregisterGeneration,
} from "@/lib/active-generations"
import { formatProviderError } from "@/lib/provider-errors"
import { canReplayReasoning, type ModelConfig } from "@/lib/providers"
import type { NodeRow, ToolInvocationPart } from "@/lib/types"

const MAX_STEPS = 20

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
  systemPrompt: string
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
    systemPrompt,
    requestSignal,
    allNodes,
    previousMetadata,
    resumeClaim,
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

  try {
    if (resumeClaim) {
      const claim = await beginResumeAssistant(assistant.id, seedParts)
      if (claim === "missing")
        throw new ResumeClaimError("missing", "Node not found")
      if (claim === "superseded")
        throw new ResumeClaimError(
          "superseded",
          "Assistant is no longer awaiting input."
        )
      claimSucceeded = true
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
    const messages = buildModelMessages({
      nodes: contextNodes,
      replayReasoning,
    })

    let orderedParts: Parts = [...seedParts]
    let stepText = ""
    let stepReasoning = ""
    let settled = false
    const abortSignal = AbortSignal.any([requestSignal, generation.signal])

    const flushStepTextReasoning = () => {
      const reasoning = stepReasoning.trim()
      if (reasoning)
        orderedParts = [
          ...orderedParts,
          { type: "reasoning", text: reasoning },
        ]
      if (stepText)
        orderedParts = [...orderedParts, { type: "text", text: stepText }]
      stepText = ""
      stepReasoning = ""
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
      flushStepTextReasoning()
      let parts = orderedParts
      let resolved = resolveStreamTerminalOutcome(outcome, parts)
      if (resolved === "complete" && parts.length === 0) {
        parts = [{ type: "text", text: "" }]
      }
      await finalizeStreamingAssistant({
        nodeId: assistant.id,
        outcome: resolved,
        parts,
        usage: payload.usage,
        finishReason: payload.finishReason,
        error: payload.error,
        config,
        previousMetadata: {
          ...parseJson<Record<string, unknown>>(assistant.metadata_json, {}),
          ...(previousMetadata ?? {}),
        },
      })
    }

    const result = streamText({
      model: languageModel,
      system: systemPrompt,
      messages,
      tools: nibchatTools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      topP: config.topP,
      frequencyPenalty: config.frequencyPenalty,
      presencePenalty: config.presencePenalty,
      stopSequences: config.stopSequences,
      providerOptions: config.providerOptions as never,
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") stepText += chunk.text
        if (chunk.type === "reasoning-delta") stepReasoning += chunk.text
        if (chunk.type === "tool-input-start") {
          flushStepTextReasoning()
          orderedParts = upsertToolInvocation(orderedParts, {
            type: "tool-invocation",
            toolCallId: chunk.id,
            toolName: chunk.toolName,
            state: "input-streaming",
            input: {},
          })
        }
        if (chunk.type === "tool-call") {
          flushStepTextReasoning()
          orderedParts = upsertToolInvocation(orderedParts, {
            type: "tool-invocation",
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            state: "input-available",
            input: chunk.input,
          })
        }
        if (chunk.type === "tool-result") {
          flushStepTextReasoning()
          const existing = orderedParts.find(
            (p): p is ToolInvocationPart =>
              p.type === "tool-invocation" && p.toolCallId === chunk.toolCallId
          )
          orderedParts = upsertToolInvocation(orderedParts, {
            type: "tool-invocation",
            toolCallId: chunk.toolCallId,
            toolName: existing?.toolName ?? chunk.toolName,
            state: "output-available",
            input: existing?.input ?? chunk.input ?? {},
            output: chunk.output,
          })
        }
      },
      onFinish: async ({ usage, finishReason }) => {
        try {
          flushStepTextReasoning()
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
          console.error("[nibchat/stream]", error)
          await finalizeOnce("error", {
            error: formatProviderError(error),
          })
        } finally {
          dropRegistration()
        }
      },
    })

    const response = createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        sendReasoning: true,
        onError: formatProviderError,
      }),
    })

    const withHeaders = new Headers(response.headers)
    for (const [k, v] of Object.entries(headers)) withHeaders.set(k, v)
    withHeaders.set("X-Accel-Buffering", "no")
    withHeaders.set("X-Nibchat-Assistant-Node", assistant.id)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: withHeaders,
    })
  } catch (error) {
    if (claimSucceeded && resumeClaim) {
      try {
        await restoreAwaitingInput(assistant.id, resumeClaim.originalParts)
      } catch (restoreError) {
        console.error("[nibchat/stream] restoreAwaitingInput", restoreError)
      }
    }
    dropRegistration()
    throw error
  }
}
