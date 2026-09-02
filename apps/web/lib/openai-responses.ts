import type { LanguageModel } from "ai"
import type { ProviderProtocol } from "@/lib/provider-catalog"

type ModelV4 = {
  readonly specificationVersion: "v4"
  readonly provider: string
  readonly modelId: string
  readonly supportedUrls?: unknown
  doGenerate(options: unknown): PromiseLike<unknown>
  doStream(options: unknown): PromiseLike<unknown>
}

/** Add the small set of OpenAI Responses defaults owned by the application. */
export function openAIResponsesModel(options: {
  model: ModelV4
  promptCacheKey?: string
  defaultReasoningSummary?: boolean
}): LanguageModel {
  const withDefaults = (input: unknown) => {
    if (!isRecord(input)) return input
    const providerOptions = isRecord(input.providerOptions)
      ? { ...input.providerOptions }
      : {}
    const openai = isRecord(providerOptions.openai)
      ? { ...providerOptions.openai }
      : {}
    const include = Array.isArray(openai.include) ? [...openai.include] : []
    if (!include.includes("reasoning.encrypted_content"))
      include.push("reasoning.encrypted_content")
    // The persisted nibchat tree is the source of truth. Stateless replay
    // avoids expiring item references and works for branches and edits.
    openai.store = false
    // Local tree selection is authoritative; do not attach hidden linear state.
    delete openai.previousResponseId
    delete openai.conversation
    openai.include = include
    if (options.promptCacheKey && openai.promptCacheKey === undefined)
      openai.promptCacheKey = options.promptCacheKey
    if (
      options.defaultReasoningSummary &&
      openai.reasoningSummary === undefined
    )
      openai.reasoningSummary = "auto"
    providerOptions.openai = openai
    return { ...input, providerOptions }
  }

  return withIdentity(options.model, {
    doGenerate: (input) => options.model.doGenerate(withDefaults(input)),
    doStream: (input) => options.model.doStream(withDefaults(input)),
  })
}

export type ProtocolCandidate = { protocol: ProviderProtocol; model: ModelV4 }

/**
 * Select a provider-advertised protocol before streaming. A retry is permitted
 * only for an endpoint/protocol incompatibility discovered before any bytes are
 * streamed. The successful candidate is latched for all later tool steps.
 */
export function protocolRoutedModel(options: {
  candidates: ProtocolCandidate[]
  allowFallback: boolean
}): LanguageModel & { selectedProtocol(): ProviderProtocol } {
  const candidates = options.candidates
  if (!candidates.length) throw new Error("No protocol route is available")
  let active = 0
  let latched = false
  const inputFor = (input: unknown) =>
    active === 0 ? input : stripCrossProtocolState(input)
  const call = async (method: "doGenerate" | "doStream", input: unknown) => {
    for (;;) {
      const candidate = candidates[active]!
      const nextCandidate = candidates[active + 1]
      try {
        const result = await candidate.model[method](inputFor(input))
        latched = true
        return result
      } catch (error) {
        if (
          latched ||
          !options.allowFallback ||
          active === candidates.length - 1 ||
          !isProtocolCompatibilityError(
            error,
            candidate.protocol,
            nextCandidate?.protocol
          )
        )
          throw error
        active += 1
      }
    }
  }
  return Object.assign(
    withIdentity(candidates[0]!.model, {
      doGenerate: (input) => call("doGenerate", input),
      doStream: (input) => call("doStream", input),
    }),
    { selectedProtocol: () => candidates[active]!.protocol }
  ) as LanguageModel & { selectedProtocol(): ProviderProtocol }
}

function withIdentity(
  model: ModelV4,
  calls: Pick<ModelV4, "doGenerate" | "doStream">
): LanguageModel {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    ...calls,
  } as LanguageModel
}

function stripCrossProtocolState(input: unknown) {
  if (!isRecord(input)) return input
  const next: Record<string, unknown> = {
    ...input,
    prompt: stripReasoning(input.prompt),
  }
  // Provider options are adapter-specific and cannot cross wire protocols.
  delete next.providerOptions
  return next
}

function stripReasoning(prompt: unknown) {
  if (!Array.isArray(prompt)) return prompt
  return prompt.map((message) => {
    if (!isRecord(message) || !Array.isArray(message.content)) return message
    return {
      ...message,
      content: message.content
        .filter((part) => !isRecord(part) || part.type !== "reasoning")
        .map((part) => {
          if (!isRecord(part)) return part
          const standardPart = { ...part }
          delete standardPart.providerOptions
          return standardPart
        }),
    }
  })
}

function isProtocolCompatibilityError(
  error: unknown,
  currentProtocol: ProviderProtocol,
  nextProtocol: ProviderProtocol | undefined
) {
  const value = deepestApiError(error) as {
    status?: number
    statusCode?: number
    message?: string
    responseBody?: unknown
  }
  const status = value?.statusCode ?? value?.status
  if (
    status === 500 ||
    status === 501 ||
    status === 405 ||
    status === 415 ||
    status === 422
  )
    return true
  const detail =
    `${value.message ?? ""}\n${stringify(value.responseBody)}`.toLowerCase()
  if (status === 404)
    return !/\b(model|deployment)\b.{0,50}\b(not found|does not exist|unknown)\b/.test(
      detail
    )
  if (status !== 400) return false
  if (
    /\b(unsupported|not supported|unknown)\b.{0,80}\b(endpoint|protocol|field|parameter|input|item|request)\b/.test(
      detail
    )
  )
    return true
  // Some gateways mask a Chat-only upstream behind their `/responses` route
  // as a non-retryable 400 with no compatibility details. This contradictory
  // server-error body is safe to probe only in Auto's Responses -> Chat path.
  return (
    currentProtocol === "responses" &&
    nextProtocol === "chat" &&
    /\binternal server error\b/.test(detail)
  )
}

// The AI SDK wraps retryable provider failures in AI_RetryError. Its outer
// object intentionally has no HTTP status, while the final attempt retains it.
function deepestApiError(error: unknown): unknown {
  let current = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (!isRecord(current) || !Array.isArray(current.errors)) break
    const last = current.errors.at(-1)
    if (!last) break
    current = last
  }
  return current
}

function stringify(value: unknown) {
  try {
    return typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    return ""
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
