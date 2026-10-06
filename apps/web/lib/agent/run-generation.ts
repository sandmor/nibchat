import type { LanguageModel } from "ai"
import { generationStreamStore } from "@/lib/generation-streams/default-port"
import { generationExecutor } from "@/lib/generation-streams/default-port"
import {
  reduceGenerationPayload,
  type GenerationPayload,
} from "@/lib/generation-streams/events"
import type { GenerationProducer } from "@/lib/generation-streams/ports"
import { startProducerGuards } from "@/lib/generation-streams/producer-session"
import { activateGenerationRun } from "@/lib/generation-runs"
import { buildEmbeddedModelMessages } from "@/lib/agent/build-messages-embed"
import { buildModelMessages } from "@/lib/agent/build-messages"
import {
  continueTaskInputSchema,
  taskInputSchema,
} from "@/lib/agent/tools/task-shared"
import {
  partsHavePendingClientTools,
  resolveStreamTerminalOutcome,
  type Parts,
} from "@/lib/agent/parts"
import { runModelLoop } from "@/lib/agent/model-loop"
import { type AgentGenerationOptions } from "@/lib/agent/generation-options"
import { createNibchatTools, reservedBuiltInToolNames } from "@/lib/agent/tools"
import { getBuiltInToolsPrefs } from "@/lib/user-settings"
import { getAgentLimits } from "@/lib/user-settings"
import { taskDepth } from "@/lib/agent/task-depth"
import {
  logDiagnosticFailure,
  diagnosticErrorFields,
  type DiagnosticOperationHandle,
  startDiagnosticOperation,
} from "@/lib/diagnostics"
import { effectiveContextBooks } from "@/lib/chat-service"
import {
  resolveContextEntries,
  type ContextScanMessage,
} from "@/lib/context-books"
import {
  beginResumeAssistant,
  checkpointStreamingAssistant,
  finalizeStreamingAssistantWithSnapshot,
  restoreAwaitingInput,
} from "@/lib/chat-service"
import {
  ancestorPath,
  branchIdForContinuation,
  branchIdsOf,
  parseJson,
} from "@/lib/domain"
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
  normalizePromptStack,
  resolvePromptVariableValues,
  type PromptStackDocument,
} from "@/lib/prompt-stack"
import { parseSettingValues } from "@/lib/chat-settings"
import {
  chatIdentityFromRow,
  expandPromptMacros,
  idleSinceFromPath,
  normalizeTimeZone,
} from "@/lib/prompt-macros"
import { prepareMcpTools } from "@/lib/mcp"
import { assertPdfFallbackAvailable } from "@/lib/pdf-input"
import { getPdfImagePageLimit } from "@/lib/user-settings"
import { createToolDiagnostics } from "@/lib/agent/tool-diagnostics"
import type {
  DiagnosticMetadata,
  DiagnosticTerminalOutcome,
} from "@/lib/diagnostic-contract"
import type { NodeRow, ToolInvocationPart } from "@/lib/types"
import { db } from "@/lib/db"

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
  diagnostic?: DiagnosticOperationHandle
  userId: string
  assistant: NodeRow
  /** Context ends at this node (inclusive). */
  contextLeafId: string | null
  /** Base parts already on the assistant (resume after tools). */
  seedParts?: Parts
  /** Replay durable parts from an interrupted assistant after its parent context. */
  replaySeedParts?: boolean
  config: ModelConfig
  languageModel: LanguageModel
  responsesReplay?: ResponsesReplayTarget
  selectedProtocol?: () => string | undefined
  rememberProtocol?: (protocol: string) => Promise<void>
  promptStack: PromptStackDocument
  /** Space-resolved overrides; when omitted, the chat row is read. */
  variableOverrides?: Record<string, unknown>
  /** Effective rules for the chat's space branch. */
  spaceRulesText?: string
  /** Browser IANA time zone supplied for prompt macro expansion. */
  timeZone: string
  allNodes: NodeRow[]
  previousMetadata?: Record<string, unknown>
  /**
   * When set, claim awaiting_input → streaming with seedParts inside the
   * generation runner, and restore originalParts if setup fails before the
   * stream response is returned.
   */
  resumeClaim?: {
    originalParts: Parts
    action?: {
      id: string
      userId: string
      chatId: string
      requestHash: string
    }
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
} & AgentGenerationOptions

/**
 * Run streamText with nibchat tools, stream UI events to the client, and persist
 * terminal parts (complete | awaiting_input | stopped | error).
 */
export async function startGenerationProducer(
  setup: GenerationSetup
): Promise<void> {
  const {
    userId,
    assistant,
    contextLeafId,
    seedParts = [],
    replaySeedParts,
    config,
    languageModel,
    responsesReplay,
    selectedProtocol,
    rememberProtocol,
    promptStack,
    variableOverrides,
    spaceRulesText,
    timeZone,
    allNodes,
    previousMetadata,
    resumeClaim,
    afterFinalize,
    generationId,
    maxSteps: requestedMaxSteps,
    toolPolicy,
    onLiveText,
    externalAbort,
    whenSettled,
  } = setup

  const diagnostic =
    setup.diagnostic ??
    (await startDiagnosticOperation({
      id: generationId,
      kind: "chat.reply.generate",
      context: {
        userId,
        chatId: assistant.chat_id,
        generationId,
        providerId: config.providerId,
        model: config.model,
      },
      metadata: {
        providerId: config.providerId,
        model: config.model,
      },
    }))

  const generation = new AbortController()
  if (externalAbort) {
    if (externalAbort.aborted) generation.abort()
    else
      externalAbort.addEventListener("abort", () => generation.abort(), {
        once: true,
      })
  }
  registerGeneration(assistant.id, generation)
  let registered = true
  const dropRegistration = () => {
    if (!registered) return
    unregisterGeneration(assistant.id)
    registered = false
  }

  let claimSucceeded = false
  let settledNotified = false
  const notifySettled = async (
    outcome: "complete" | "awaiting_input" | "aborted" | "error",
    parts: Parts,
    metadata: DiagnosticMetadata = {},
    diagnosticOutcome: DiagnosticTerminalOutcome = outcome === "aborted"
      ? generation.signal.aborted
        ? "cancelled"
        : "interrupted"
      : outcome
  ) => {
    if (settledNotified) return
    settledNotified = true
    await diagnostic.finish(diagnosticOutcome, {
      status: outcome,
      ...(outcome === "aborted" ? { reason: "aborted" } : {}),
      ...metadata,
    })
    try {
      whenSettled?.({ outcome, parts })
    } catch (error) {
      logDiagnosticFailure(
        "generation.settled_callback_failed",
        error,
        "warn",
        {
          generationId,
        }
      )
    }
  }
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

  try {
    if (resumeClaim) {
      const claim = await beginResumeAssistant(
        assistant.id,
        seedParts,
        generationId,
        resumeClaim.action
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
        logDiagnosticFailure(
          "generation.terminal_publish_failed",
          error,
          "warn",
          {
            generationId,
          }
        )
      )
      await notifySettled(
        "aborted",
        seedParts,
        { reason: "claim_lost" },
        "skipped"
      )
      producerGuards.stop()
      producerGuards = null
      if (!terminalPublished) await generationStreamStore.close(producerHandle)
      dropRegistration()
      return
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
    const branchIds = branchIdsOf(nodesForContext)
    const assistantBranchId =
      branchIds.get(assistant.id) ??
      branchIdForContinuation(nodesForContext, contextLeafId)
    const historyEnabled = normalizePromptStack(promptStack).modules.some(
      (module) => module.kind === "history" && module.enabled
    )
    const replayReasoning = await canReplayReasoning(userId, config)
    const pdfInputMode = await pdfInputModeFor(userId, config)
    const pdfImagePageLimit = await getPdfImagePageLimit(userId)
    if (historyEnabled && pdfInputMode === "extracted")
      assertPdfFallbackAvailable(
        contextNodes.flatMap((node) =>
          node.role === "user" &&
          !node.excluded_from_context &&
          !(node.status === "error" && !node.search_text)
            ? parseJson<Parts>(node.parts_json, [])
            : []
        )
      )
    const includeMcp = toolPolicy?.mcp !== "none"
    const mcpServerInstructionsEnabled =
      includeMcp &&
      promptStack.modules.some(
        (module) => module.kind === "mcp-instructions" && module.enabled
      )
    // Tools always register from global MCP profiles; this stack module only
    // injects server initialize instructions (if any) at its stack position.
    const chat = await db
      .selectFrom("chats")
      .select(["id", "created_at", "settings_json", "kind"])
      .where("id", "=", assistant.chat_id)
      .where("user_id", "=", userId)
      .executeTakeFirst()
    const chatIdentity = chatIdentityFromRow(chat)
    const macroContext = {
      requestKind: "reply" as const,
      now: new Date(),
      timeZone: normalizeTimeZone(timeZone),
      idleSince: idleSinceFromPath(contextNodes),
      branchId: assistantBranchId,
      ...(chatIdentity ? { chat: chatIdentity } : {}),
      variables: resolvePromptVariableValues(
        promptStack.variables ?? [],
        variableOverrides ??
          parseSettingValues(chat?.settings_json).variables ??
          {}
      ),
    }
    const contextBooks = await effectiveContextBooks(userId, assistant.chat_id)
    const scanMessages: ContextScanMessage[] = contextNodes.flatMap((node) => {
      if (
        node.excluded_from_context ||
        (node.role !== "user" && node.role !== "assistant")
      )
        return []
      const text = parseJson<Parts>(node.parts_json, [])
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
      return [{ role: node.role, text }]
    })
    const resolvedEntries = resolveContextEntries({
      books: contextBooks,
      messages: scanMessages,
      scanDepth: config.contextScanDepth,
      macroContext,
    })
    const macroContextWithBooks = {
      ...macroContext,
      contextEntries: resolvedEntries.namespaces,
    }
    const modelNodes = config.expandMessageMacros
      ? contextNodes.map((node) => ({
          ...node,
          parts_json: JSON.stringify(
            parseJson<Parts>(node.parts_json, []).map((part) =>
              part.type === "text"
                ? {
                    ...part,
                    text: expandPromptMacros(part.text, {
                      ...macroContextWithBooks,
                      branchId: branchIds.get(node.id) ?? "",
                    }),
                  }
                : part
            )
          ),
        }))
      : contextNodes
    const pathMessages = historyEnabled
      ? await buildEmbeddedModelMessages({
          nodes: modelNodes,
          replayReasoning,
          responsesReplay,
          pdfInputMode,
          pdfImagePageLimit,
        })
      : []
    const assignmentMessages =
      !historyEnabled && chat?.kind === "agent_run"
        ? await buildEmbeddedModelMessages({
            nodes: modelNodes.filter((node) => node.role === "user").slice(-1),
            replayReasoning: false,
            responsesReplay,
            pdfInputMode,
            pdfImagePageLimit,
          })
        : []
    const [mcp, builtInPrefs] = await Promise.all([
      includeMcp
        ? prepareMcpTools({
            includeInstructionsText: mcpServerInstructionsEnabled,
            reservedToolNames: reservedBuiltInToolNames,
            macroContext: macroContextWithBooks,
          })
        : Promise.resolve({
            tools: {},
            warnings: [] as string[],
            instructionsText: "",
          }),
      getBuiltInToolsPrefs(userId),
    ])
    if (mcp.warnings?.length)
      await diagnostic.warn("mcp_configuration", {
        count: mcp.warnings.length,
        phase: "setup",
      })
    const assembled = assemblePromptContext({
      stack: promptStack,
      pathMessages,
      mcpServerInstructionsText: includeMcp ? mcp.instructionsText : undefined,
      macroContext: macroContextWithBooks,
      spaceRulesText,
    })
    const systemPrompt = assembled.system
    const messages = [...assembled.messages, ...assignmentMessages]

    let orderedParts: Parts = [...seedParts]
    let settled = false
    // HTTP readers are subscribers only. Explicit server-side cancellation is
    // the sole signal that may stop the provider request.
    const abortSignal = generation.signal

    let appendChain = Promise.resolve()
    const appendEvent = (event: GenerationPayload) => {
      const run = appendChain.then(async () => {
        if (!producerHandle) throw new Error("Generation stream was not opened")
        orderedParts = reduceGenerationPayload(orderedParts, event)
        await generationStreamStore.append(producerHandle, event)
        if (
          event.type === "tool-upsert" &&
          (event.tool.state === "output-available" ||
            event.tool.state === "output-error" ||
            Boolean(event.tool.metadata?.task))
        )
          await checkpointStreamingAssistant({
            nodeId: assistant.id,
            generationId,
            parts: withoutTransientStreamIds(
              orderedParts.filter(
                (part) =>
                  part.type !== "tool-invocation" ||
                  part.state === "output-available" ||
                  part.state === "output-error" ||
                  Boolean(part.metadata?.task)
              )
            ),
          })
      })
      appendChain = run.then(
        () => undefined,
        () => undefined
      )
      return run
    }
    const cancellationWasRequested = async () => {
      if (generation.signal.aborted) return true
      try {
        return await generationStreamStore.isCancelled(generationId)
      } catch (error) {
        logDiagnosticFailure("generation.cancel_check_failed", error, "warn", {
          generationId,
        })
        return false
      }
    }

    let firstContentMs: number | undefined
    const finalizeOnce = async (
      outcome: "complete" | "awaiting_input" | "aborted" | "error",
      payload: {
        usage?: unknown
        finishReason?: string
        error?: string
        diagnostic?: DiagnosticMetadata
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
        logDiagnosticFailure(
          "generation.terminal_publish_failed",
          error,
          "warn",
          {
            generationId,
          }
        )
      )
      const diagnosticOutcome =
        terminal.result === "missing" || terminal.result === "superseded"
          ? "skipped"
          : terminal.result === "deleted"
            ? "cancelled"
            : resolved === "aborted"
              ? generation.signal.aborted
                ? "cancelled"
                : "interrupted"
              : resolved
      await notifySettled(
        resolved,
        parts,
        {
          usage: payload.usage,
          finishReason: payload.finishReason,
          firstContentMs,
          ...payload.diagnostic,
          ...(terminal.result === "missing" ||
          terminal.result === "superseded" ||
          terminal.result === "deleted"
            ? { reason: terminal.result }
            : {}),
        },
        diagnosticOutcome
      )
      if (
        rememberProtocol &&
        (resolved === "complete" || resolved === "awaiting_input") &&
        selectedProtocol?.()
      )
        void rememberProtocol(selectedProtocol()!).catch((error) =>
          logDiagnosticFailure(
            "provider.protocol_learning_failed",
            error,
            "warn",
            {
              providerId: config.providerId,
              model: config.model,
            }
          )
        )
      if (afterFinalize) {
        void afterFinalize({ outcome: resolved, parts }).catch((error) => {
          logDiagnosticFailure(
            "generation.after_finalize_failed",
            error,
            "warn",
            {
              generationId,
              chatId: assistant.chat_id,
            }
          )
        })
      }
    }

    const { agentDepth, maxModelSteps } = await getAgentLimits(userId)
    const maxSteps = requestedMaxSteps ?? maxModelSteps
    const disabledTools = new Set(builtInPrefs.disabled)
    if (toolPolicy?.question === false) disabledTools.add("question")
    if (
      toolPolicy?.task === false ||
      (await taskDepth(userId, assistant.chat_id)) >= agentDepth
    )
      disabledTools.add("task")
    if (toolPolicy?.task === false) disabledTools.add("continue_task")
    const builtInTools = await createNibchatTools({
      disabled: disabledTools,
      task:
        disabledTools.has("task") && disabledTools.has("continue_task")
          ? null
          : {
              userId,
              parentChatId: assistant.chat_id,
              parentNodeId: assistant.id,
              generationId,
              timeZone,
              abortSignal,
              publish: async (tool) => {
                await appendEvent({ type: "tool-upsert", tool })
              },
            },
    })
    const toolDiagnostics = createToolDiagnostics(diagnostic)
    if (replaySeedParts) {
      const pending = orderedParts.filter(
        (part): part is ToolInvocationPart =>
          part.type === "tool-invocation" &&
          part.state === "input-available" &&
          (part.toolName === "task" || part.toolName === "continue_task")
      )
      if (pending.length) {
        const { runAgentTask } = await import("@/lib/agent/task-run")
        await Promise.all(
          pending.map(async (part) => {
            const parsed =
              part.toolName === "task"
                ? taskInputSchema.safeParse(part.input)
                : continueTaskInputSchema.safeParse(part.input)
            try {
              if (!parsed.success)
                throw new Error(
                  "The interrupted task input could not be replayed."
                )
              const output = await toolDiagnostics.run(
                part.toolName,
                part.toolCallId,
                () =>
                  runAgentTask({
                    context: {
                      userId,
                      parentChatId: assistant.chat_id,
                      parentNodeId: assistant.id,
                      generationId,
                      timeZone,
                      abortSignal,
                      publish: async (tool) => {
                        await appendEvent({ type: "tool-upsert", tool })
                      },
                    },
                    toolCallId: part.toolCallId,
                    input: parsed.data,
                  }),
                { source: "builtin", replay: true },
                abortSignal
              )
              const latest = orderedParts.find(
                (item): item is ToolInvocationPart =>
                  item.type === "tool-invocation" &&
                  item.toolCallId === part.toolCallId
              )
              await appendEvent({
                type: "tool-upsert",
                tool: {
                  ...(latest ?? part),
                  state: "output-available",
                  output,
                },
              })
            } catch (error) {
              await toolDiagnostics.validationFailure(
                part.toolName,
                part.toolCallId,
                error
              )
              await appendEvent({
                type: "tool-upsert",
                tool: {
                  ...part,
                  state: "output-error",
                  errorText: formatProviderError(error),
                },
              })
            }
          })
        )
      }
      messages.push(
        ...buildModelMessages({
          nodes: [
            {
              ...assistant,
              parts_json: JSON.stringify(orderedParts),
            },
          ],
          replayReasoning,
          responsesReplay,
        })
      )
    }
    let completedSteps = 0
    const result = runModelLoop({
      model: languageModel,
      system: systemPrompt,
      messages,
      tools: { ...mcp.tools, ...builtInTools },
      maxSteps,
      abortSignal,
      config,
      appendEvent,
      getParts: () => orderedParts,
      onLiveText,
      diagnostic,
      toolDiagnostics,
      onFirstContent: (elapsed) => {
        firstContentMs = elapsed
      },
      onStepEnd: async () => {
        completedSteps++
        await appendChain
        await checkpointStreamingAssistant({
          nodeId: assistant.id,
          generationId,
          parts: withoutTransientStreamIds(orderedParts),
        })
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
          if (finishReason === "tool-calls" && completedSteps >= maxSteps) {
            await finalizeOnce("error", {
              error: `Model step limit (${maxSteps}) reached before a final answer.`,
              usage,
              finishReason,
              diagnostic: { reason: "step_limit", phase: "model" },
            })
          } else {
            await finalizeOnce("complete", { usage, finishReason })
          }
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
      onError: async (error) => {
        try {
          if (await cancellationWasRequested()) {
            generation.abort()
            await finalizeOnce("aborted")
            return
          }
          await appendEvent({
            type: "error",
            errorText: formatProviderError(error),
          }).catch(() => {})
          await finalizeOnce("error", {
            error: formatProviderError(error),
            diagnostic: {
              ...diagnosticErrorFields(error),
              reason: "stream_failed",
              phase: "stream",
            },
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
            cancelled
              ? { diagnostic: { reason: "cancel_requested" } }
              : {
                  error: formatProviderError(error),
                  diagnostic: {
                    ...diagnosticErrorFields(error),
                    reason: "consume_failed",
                    phase: "consume",
                  },
                }
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

    return
  } catch (error) {
    if (claimSucceeded && resumeClaim) {
      try {
        await restoreAwaitingInput(
          assistant.id,
          resumeClaim.originalParts,
          generationId,
          resumeClaim.action?.id
        )
      } catch (restoreError) {
        logDiagnosticFailure(
          "generation.restore_awaiting_input_failed",
          restoreError,
          "error",
          { generationId, chatId: assistant.chat_id }
        )
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
          logDiagnosticFailure(
            "generation.terminal_publish_failed",
            terminalError,
            "warn",
            { generationId }
          )
        )
      } catch (finalizeError) {
        logDiagnosticFailure(
          "generation.setup_finalization_failed",
          finalizeError,
          "error",
          { generationId, chatId: assistant.chat_id }
        )
      }
    }
    if (error instanceof ResumeClaimError)
      await diagnostic.finish("skipped", { reason: error.kind, phase: "claim" })
    await notifySettled("error", seedParts, {
      ...diagnosticErrorFields(error),
      reason: "setup_failed",
      phase: "setup",
    })
    dropRegistration()
    producerGuards?.stop()
    if (producerHandle && !terminalPublished)
      await generationStreamStore.close(producerHandle).catch(() => {})
    throw error
  }
}
