import type { ModelMessage } from "ai"
import { z } from "zod"

export const DEFAULT_PROMPT_STACK_ID = "default"
export const DEFAULT_HISTORY_MODULE_ID = "chat-history"
export const DEFAULT_MCP_INSTRUCTIONS_MODULE_ID = "mcp-instructions"
export const HISTORY_MODULE_NAME = "Chat history" as const
export const MCP_INSTRUCTIONS_MODULE_NAME = "MCP server instructions" as const

const SYSTEM_AFTER_NON_SYSTEM_MSG =
  "System after chat or non-system may be remapped to assistant for some providers."

const moduleRoleSchema = z.enum(["system", "user", "assistant"])
const placementSchema = z.enum(["relative", "in_chat"])

export const historyModuleSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("history"),
  /** Canonicalized to HISTORY_MODULE_NAME on normalize. */
  name: z.string().min(1),
  enabled: z.boolean(),
})

export const mcpInstructionsModuleSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("mcp-instructions"),
  /** Canonicalized to MCP_INSTRUCTIONS_MODULE_NAME on normalize. */
  name: z.string().min(1),
  enabled: z.boolean(),
})

export const promptModuleSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("prompt"),
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  body: z.string().max(50_000),
  placement: placementSchema,
  depth: z.number().int().min(0).max(10_000).optional(),
  role: moduleRoleSchema,
})

export const stackModuleSchema = z.discriminatedUnion("kind", [
  historyModuleSchema,
  mcpInstructionsModuleSchema,
  promptModuleSchema,
])

export const promptStackDocumentSchema = z.object({
  modules: z.array(stackModuleSchema).max(100),
})

export type HistoryModule = {
  id: string
  kind: "history"
  name: string
  enabled: boolean
}
export type McpInstructionsModule = {
  id: string
  kind: "mcp-instructions"
  name: string
  enabled: boolean
}
export type PromptModule = z.infer<typeof promptModuleSchema>
export type StackModule =
  | HistoryModule
  | McpInstructionsModule
  | PromptModule
export type PromptStackDocument = { modules: StackModule[] }
export type ModuleRole = z.infer<typeof moduleRoleSchema>
export type ModulePlacement = z.infer<typeof placementSchema>

export function defaultHistoryModule(
  id = DEFAULT_HISTORY_MODULE_ID
): HistoryModule {
  return {
    id,
    kind: "history",
    name: HISTORY_MODULE_NAME,
    enabled: true,
  }
}

export function defaultMcpInstructionsModule(
  id = DEFAULT_MCP_INSTRUCTIONS_MODULE_ID
): McpInstructionsModule {
  return {
    id,
    kind: "mcp-instructions",
    name: MCP_INSTRUCTIONS_MODULE_NAME,
    enabled: true,
  }
}

export function defaultPromptStack(): PromptStackDocument {
  return {
    modules: [
      {
        id: "default-system",
        kind: "prompt",
        name: "System",
        enabled: true,
        body: "You are a helpful assistant.",
        placement: "relative",
        role: "system",
      },
      defaultMcpInstructionsModule(),
      defaultHistoryModule(),
    ],
  }
}

/**
 * Canonical form: exactly one history and MCP-instructions module, force canonical names,
 * strip relative depth. Throws on duplicates (no silent drop).
 */
export function normalizePromptStack(
  doc: PromptStackDocument
): PromptStackDocument {
  const historyCount = doc.modules.filter((m) => m.kind === "history").length
  if (historyCount > 1) {
    throw new Error("Prompt stack must contain exactly one history module")
  }
  const mcpInstructionsCount = doc.modules.filter(
    (m) => m.kind === "mcp-instructions"
  ).length
  if (mcpInstructionsCount > 1)
    throw new Error("Prompt stack must contain exactly one MCP instructions module")

  let historySeen = false
  let mcpInstructionsSeen = false
  const modules: StackModule[] = []

  for (const raw of doc.modules) {
    if (raw.kind === "history") {
      historySeen = true
      modules.push({
        id: raw.id,
        kind: "history",
        name: HISTORY_MODULE_NAME,
        enabled: raw.enabled,
      })
      continue
    }
    if (raw.kind === "mcp-instructions") {
      mcpInstructionsSeen = true
      modules.push({
        id: raw.id,
        kind: "mcp-instructions",
        name: MCP_INSTRUCTIONS_MODULE_NAME,
        enabled: raw.enabled,
      })
      continue
    }
    const role = raw.role ?? "system"
    if (raw.placement === "in_chat") {
      modules.push({
        id: raw.id,
        kind: "prompt",
        name: raw.name.trim() || "Untitled",
        enabled: raw.enabled,
        body: raw.body,
        placement: "in_chat",
        depth: raw.depth ?? 0,
        role,
      })
    } else {
      modules.push({
        id: raw.id,
        kind: "prompt",
        name: raw.name.trim() || "Untitled",
        enabled: raw.enabled,
        body: raw.body,
        placement: "relative",
        role,
      })
    }
  }

  if (!historySeen) {
    modules.push(defaultHistoryModule())
  }
  if (!mcpInstructionsSeen) {
    const historyIndex = modules.findIndex(
      (module) => module.kind === "history"
    )
    modules.splice(
      historyIndex < 0 ? modules.length : historyIndex,
      0,
      defaultMcpInstructionsModule()
    )
  }

  return { modules }
}

/** Zod parse + normalize; throws on invalid shape or multi-history. */
export function requirePromptStack(value: unknown): PromptStackDocument {
  const parsed = promptStackDocumentSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error("Invalid prompt stack document")
  }
  return normalizePromptStack(parsed.data as PromptStackDocument)
}

/** Parse stack_json from DB/backup; wraps JSON errors clearly. */
export function readStackJson(stackJson: string): PromptStackDocument {
  let value: unknown
  try {
    value = JSON.parse(stackJson)
  } catch (cause) {
    throw new Error("Invalid prompt stack document", { cause })
  }
  try {
    return requirePromptStack(value)
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message === "Invalid prompt stack document"
    ) {
      throw cause
    }
    throw new Error("Invalid prompt stack document", { cause })
  }
}

export function promptStackToJson(
  doc: PromptStackDocument,
  pretty = false
): string {
  return JSON.stringify(normalizePromptStack(doc), null, pretty ? 2 : undefined)
}

export type ResolvePromptStackResult = {
  stack: PromptStackDocument
  source: "chat" | "instance" | "fallback" | "code"
  stackId: string | null
  missingStackId?: string
}

/**
 * Resolve which stack document applies for a chat (reference-only).
 * Soft code default only when an id is missing from the map — not on parse failure.
 */
export function resolvePromptStack(options: {
  chatStackId: string | null | undefined
  defaultStackId: string | null | undefined
  stacksById: Map<string, PromptStackDocument>
}): ResolvePromptStackResult {
  const chatId = options.chatStackId ?? null
  if (chatId) {
    const found = options.stacksById.get(chatId)
    if (found) {
      return {
        stack: normalizePromptStack(found),
        source: "chat",
        stackId: chatId,
      }
    }
    const fallbackId = options.defaultStackId ?? null
    if (fallbackId) {
      const fallback = options.stacksById.get(fallbackId)
      if (fallback) {
        return {
          stack: normalizePromptStack(fallback),
          source: "fallback",
          stackId: fallbackId,
          missingStackId: chatId,
        }
      }
    }
    return {
      stack: defaultPromptStack(),
      source: "code",
      stackId: null,
      missingStackId: chatId,
    }
  }

  const defaultId = options.defaultStackId ?? null
  if (defaultId) {
    const found = options.stacksById.get(defaultId)
    if (found) {
      return {
        stack: normalizePromptStack(found),
        source: "instance",
        stackId: defaultId,
      }
    }
  }
  return { stack: defaultPromptStack(), source: "code", stackId: null }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function messageFromPrompt(mod: PromptModule): ModelMessage | null {
  const text = mod.body.trim()
  if (!text) return null
  const role = mod.role
  if (role === "system") return { role: "system", content: text }
  if (role === "user") return { role: "user", content: text }
  return { role: "assistant", content: text }
}

/** Track which module ids contribute which messages for warnings. */
type TaggedMessage = {
  message: ModelMessage
  moduleId?: string
  /** Synthetic boundary: enabled history (even if inject empty). */
  historyBoundary?: boolean
}

function injectInChatTagged(
  pathMessages: ModelMessage[],
  stack: PromptStackDocument
): TaggedMessage[] {
  const historyEnabled = stack.modules.some(
    (m) => m.kind === "history" && m.enabled
  )
  if (!historyEnabled) return []

  const n = pathMessages.length
  const buckets: TaggedMessage[][] = Array.from({ length: n + 1 }, () => [])

  for (const mod of stack.modules) {
    if (mod.kind !== "prompt" || !mod.enabled || mod.placement !== "in_chat")
      continue
    const msg = messageFromPrompt(mod)
    if (!msg) continue
    const depth = mod.depth ?? 0
    const idx = clamp(n - depth, 0, n)
    buckets[idx]!.push({ message: msg, moduleId: mod.id })
  }

  const working: TaggedMessage[] = []
  for (let i = 0; i < n; i++) {
    working.push(...buckets[i]!, { message: pathMessages[i]! })
  }
  working.push(...buckets[n]!)
  return working
}

/**
 * Build model messages before peel/demote (includes system mid-list).
 * Tags prompt modules (relative + in_chat) with moduleId for warnings.
 */
function assembleTagged(options: {
  stack: PromptStackDocument
  pathMessages: ModelMessage[]
  mcpServerInstructionsText?: string
}): TaggedMessage[] {
  const stack = normalizePromptStack(options.stack)
  const injectedHistory = injectInChatTagged(options.pathMessages, stack)
  const out: TaggedMessage[] = []

  for (const mod of stack.modules) {
    if (!mod.enabled) continue
    if (mod.kind === "history") {
      // Boundary even when inject is empty (settings empty-path case).
      out.push({
        message: { role: "user", content: "" },
        historyBoundary: true,
      })
      for (const t of injectedHistory) {
        out.push(t)
      }
      continue
    }
    if (mod.kind === "mcp-instructions") {
      const text = options.mcpServerInstructionsText?.trim()
      if (text)
        out.push({
          message: { role: "system", content: text },
          moduleId: mod.id,
        })
      continue
    }
    if (mod.placement === "in_chat") continue
    const msg = messageFromPrompt(mod)
    if (!msg) continue
    out.push({ message: msg, moduleId: mod.id })
  }
  return out
}

function collectWarnings(tagged: TaggedMessage[]): AssemblyWarning[] {
  let sawNonSystem = false
  const warnings: AssemblyWarning[] = []
  const seen = new Set<string>()

  for (const t of tagged) {
    if (t.historyBoundary) {
      sawNonSystem = true
      continue
    }
    if (t.message.role !== "system") {
      sawNonSystem = true
      continue
    }
    if (sawNonSystem && t.moduleId && !seen.has(t.moduleId)) {
      seen.add(t.moduleId)
      warnings.push({
        moduleId: t.moduleId,
        message: SYSTEM_AFTER_NON_SYSTEM_MSG,
      })
    }
  }
  return warnings
}

function peelAndDemote(tagged: TaggedMessage[]): {
  system: string
  messages: ModelMessage[]
  demotedModuleIds: string[]
} {
  // Skip synthetic history boundaries when peeling content.
  const contentTagged = tagged.filter((t) => !t.historyBoundary)

  const systemParts: string[] = []
  let i = 0
  while (
    i < contentTagged.length &&
    contentTagged[i]!.message.role === "system"
  ) {
    const content = contentTagged[i]!.message.content
    if (typeof content === "string" && content.trim()) {
      systemParts.push(content.trim())
    }
    i++
  }

  const rest = contentTagged.slice(i)
  const demotedModuleIds: string[] = []
  const messages: ModelMessage[] = rest.map((t) => {
    if (t.message.role === "system") {
      if (t.moduleId) demotedModuleIds.push(t.moduleId)
      const content =
        typeof t.message.content === "string" ? t.message.content : ""
      return { role: "assistant" as const, content }
    }
    return t.message
  })

  return {
    system: systemParts.join("\n\n"),
    messages,
    demotedModuleIds,
  }
}

export type AssemblyWarning = {
  moduleId: string
  message: string
}

export type AssemblePromptContextResult = {
  system: string
  messages: ModelMessage[]
  /** Modules whose system role would sit after non-system content (pre-demote). */
  demotedModuleIds: string[]
  warnings: AssemblyWarning[]
}

/**
 * Build AI SDK `system` + `messages` from stack order and path history.
 */
export function assemblePromptContext(options: {
  stack: PromptStackDocument
  pathMessages: ModelMessage[]
  /** MCP server initialize instructions when this module is enabled. */
  mcpServerInstructionsText?: string
}): AssemblePromptContextResult {
  const tagged = assembleTagged(options)
  const warnings = collectWarnings(tagged)
  const { system, messages, demotedModuleIds } = peelAndDemote(tagged)
  return { system, messages, demotedModuleIds, warnings }
}

/**
 * Modules that would appear as system after a non-system block (before demote).
 * Same pass as assemble; prefer using assemblePromptContext().warnings when assembling.
 */
export function findSystemAfterNonSystemWarnings(
  stack: PromptStackDocument,
  pathMessages: ModelMessage[]
): AssemblyWarning[] {
  return assemblePromptContext({ stack, pathMessages }).warnings
}

export function newModuleId() {
  return crypto.randomUUID()
}

export function createEmptyModule(
  placement: ModulePlacement = "relative"
): PromptModule {
  return {
    id: newModuleId(),
    kind: "prompt",
    name: "New module",
    enabled: true,
    body: "",
    placement,
    role: "system",
    ...(placement === "in_chat" ? { depth: 0 } : {}),
  }
}

export function placementLabel(placement: ModulePlacement): string {
  switch (placement) {
    case "relative":
      return "Relative"
    case "in_chat":
      return "In chat"
  }
}

export function isHistoryModule(mod: StackModule): mod is HistoryModule {
  return mod.kind === "history"
}

export function isPromptModule(mod: StackModule): mod is PromptModule {
  return mod.kind === "prompt"
}
