import dayjs, { type Dayjs } from "dayjs"
import advancedFormat from "dayjs/plugin/advancedFormat"
import customParseFormat from "dayjs/plugin/customParseFormat"
import duration from "dayjs/plugin/duration"
import localizedFormat from "dayjs/plugin/localizedFormat"
import relativeTime from "dayjs/plugin/relativeTime"
import timezone from "dayjs/plugin/timezone"
import utc from "dayjs/plugin/utc"
import { sha256 } from "@noble/hashes/sha2.js"

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(duration)
dayjs.extend(relativeTime)
dayjs.extend(customParseFormat)
dayjs.extend(localizedFormat)
dayjs.extend(advancedFormat)

const DEFAULT_TIME_ZONE = "UTC"
const MAX_EXPANSION_DEPTH = 12
const UTC_OFFSET = /^UTC([+-])(\d{1,2})(?::([0-5]\d))?$/i
const LOCAL_DATE_TIME_FORMATS = [
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DD",
]

export type MacroContext = {
  now: Date
  timeZone: string
  /** The user message preceding the currently generated turn, when available. */
  idleSince?: Date
  /** Stable chat identity, when rendering a conversation-scoped value. */
  chat?: { id: string; createdAt: Date }
}

export type MacroPickerGroupId = "chat" | "time" | "transform"

export type MacroDefinition = {
  name: string
  /** Short label for the insert picker. Falls back to `name`. */
  summary?: string
  /** Inserted text. Defaults to `{{name}}`. */
  snippet?: string
  /** Insert-picker section. Defaults to `time`. */
  group?: MacroPickerGroupId
  /** Picker secondary text. Transforms default to the argument form. */
  preview?: "value" | "snippet"
  evaluate: (args: readonly string[], context: MacroContext) => string | null
}

export type MacroRegistry = ReadonlyMap<string, MacroDefinition>

export type MacroPickerEntry = {
  name: string
  summary: string
  snippet: string
  group: MacroPickerGroupId
  preview: "value" | "snippet"
}

export type MacroPickerGroup = {
  id: MacroPickerGroupId
  label: string
  entries: MacroPickerEntry[]
}

export const MACRO_PICKER_GROUP_LABELS: Record<MacroPickerGroupId, string> = {
  chat: "Chat",
  time: "Time",
  transform: "Transforms",
}

const MACRO_PICKER_GROUP_ORDER: readonly MacroPickerGroupId[] = [
  "chat",
  "time",
  "transform",
]

export const SAMPLE_MACRO_CHAT = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: new Date("2026-04-16T08:00:00.000Z"),
}

const CHAT_MACRO_RE = /{{\s*chat(?:Id|CreatedAt)\b/i

/** True when expansion needs a conversation, not just the current time. */
export function valueNeedsChatContext(value: string): boolean {
  return CHAT_MACRO_RE.test(value)
}

/** Header rendering treats leftover braces as an unresolved entry. */
export function expansionLooksUnresolved(value: string): boolean {
  return value.includes("{{") || value.includes("}}")
}

export function chatIdentityFromRow(
  row?: { id: string; created_at: string } | null
): NonNullable<MacroContext["chat"]> | undefined {
  if (!row) return undefined
  const createdAt = new Date(row.created_at)
  if (Number.isNaN(createdAt.getTime())) return undefined
  return { id: row.id, createdAt }
}

export function catalogMacroContext(
  timeZone: string,
  now: Date = new Date()
): MacroContext {
  return defaultMacroContext({
    now,
    timeZone,
    idleSince: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    chat: SAMPLE_MACRO_CHAT,
  })
}

export function macroInsertSnippet(definition: MacroDefinition): string {
  return definition.snippet ?? `{{${definition.name}}}`
}

export function macroPickerEntries(
  definitions: readonly MacroDefinition[]
): MacroPickerEntry[] {
  return definitions.map((definition) => ({
    name: definition.name,
    summary: definition.summary ?? definition.name,
    snippet: macroInsertSnippet(definition),
    group: definition.group ?? "time",
    preview:
      definition.preview ??
      (definition.group === "transform" ? "snippet" : "value"),
  }))
}

export function groupedMacroPickerEntries(
  definitions: readonly MacroDefinition[]
): MacroPickerGroup[] {
  const entries = macroPickerEntries(definitions)
  return MACRO_PICKER_GROUP_ORDER.flatMap((id) => {
    const groupEntries = entries.filter((entry) => entry.group === id)
    return groupEntries.length
      ? [{ id, label: MACRO_PICKER_GROUP_LABELS[id], entries: groupEntries }]
      : []
  })
}

/** Live value for chat/time; argument form for transforms. */
export function macroPickerPreview(
  entry: MacroPickerEntry,
  context: MacroContext | null,
  registry?: MacroRegistry
): string {
  if (!context || entry.preview === "snippet") return entry.snippet
  return expandPromptMacros(entry.snippet, context, registry)
}

export function normalizeTimeZone(value: string | null | undefined): string {
  if (!value) return DEFAULT_TIME_ZONE
  if (isSupportedTimeZone(value)) return value
  return DEFAULT_TIME_ZONE
}

export function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function defaultMacroContext(
  overrides?: Partial<MacroContext>
): MacroContext {
  const src = overrides ?? {}
  return {
    now: src.now ?? new Date(),
    timeZone: normalizeTimeZone(src.timeZone),
    ...(src.idleSince ? { idleSince: src.idleSince } : {}),
    ...(src.chat ? { chat: src.chat } : {}),
  }
}

export function createMacroRegistry(
  definitions: readonly MacroDefinition[]
): MacroRegistry {
  const registry = new Map<string, MacroDefinition>()
  for (const definition of definitions)
    registry.set(definition.name.toLowerCase(), definition)
  return registry
}

function current(context: MacroContext): Dayjs {
  return dayjs(context.now).tz(context.timeZone)
}

function offsetTime(context: MacroContext, spec: string): Dayjs | null {
  const match = UTC_OFFSET.exec(spec.trim())
  if (!match) return null
  const sign = match[1] === "+" ? 1 : -1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? "0")
  const offset = sign * (hours * 60 + minutes)
  if (hours > 14 || (hours === 14 && minutes > 0)) return null
  return dayjs(context.now).utcOffset(offset)
}

function parseTime(value: string, context: MacroContext): Dayjs | null {
  const text = value.trim()
  if (!text) return null
  for (const format of LOCAL_DATE_TIME_FORMATS) {
    if (dayjs(text, format, true).isValid())
      return dayjs.tz(text, format, context.timeZone)
  }
  const parsed = dayjs(text)
  return parsed.isValid() ? parsed : null
}

function noArgs(args: readonly string[]): boolean {
  return args.length === 0
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const textEncoder = new TextEncoder()

function integer(value: string): bigint | null {
  return /^-?\d+$/.test(value.trim()) ? BigInt(value.trim()) : null
}

function encodeBase62(bytes: Uint8Array): string {
  let value = bytes.reduce((out, byte) => (out << 8n) | BigInt(byte), 0n)
  let out = ""
  while (value) {
    out = BASE62[Number(value % 62n)]! + out
    value /= 62n
  }
  return out.padStart(43, "0")
}

export const builtInMacroDefinitions: readonly MacroDefinition[] = [
  {
    name: "time",
    summary: "Local time",
    group: "time",
    evaluate(args, context) {
      if (noArgs(args)) return current(context).format("h:mm A")
      if (args.length !== 1) return null
      return offsetTime(context, args[0]!)?.format("h:mm A") ?? null
    },
  },
  {
    name: "date",
    summary: "Local date",
    group: "time",
    evaluate: (args, context) =>
      noArgs(args) ? current(context).format("M/D/YYYY") : null,
  },
  {
    name: "weekday",
    summary: "Weekday name",
    group: "time",
    evaluate: (args, context) =>
      noArgs(args) ? current(context).format("dddd") : null,
  },
  {
    name: "isotime",
    summary: "24-hour time",
    group: "time",
    evaluate: (args, context) =>
      noArgs(args) ? current(context).format("HH:mm") : null,
  },
  {
    name: "isodate",
    summary: "ISO date",
    group: "time",
    evaluate: (args, context) =>
      noArgs(args) ? current(context).format("YYYY-MM-DD") : null,
  },
  {
    name: "datetimeformat",
    summary: "Custom format",
    group: "time",
    snippet: "{{datetimeformat::YYYY-MM-DD HH:mm}}",
    evaluate: (args, context) =>
      args.length === 1 && args[0]!.trim()
        ? current(context).format(args[0]!)
        : null,
  },
  {
    name: "chatId",
    summary: "Current chat ID",
    group: "chat",
    evaluate: (args, context) =>
      noArgs(args) ? (context.chat?.id ?? null) : null,
  },
  {
    name: "chatCreatedAt",
    summary: "Current chat creation time",
    group: "chat",
    evaluate: (args, context) => {
      if (!context.chat || args.length > 1) return null
      if (!args.length) return context.chat.createdAt.toISOString()
      return args[0] === "x"
        ? String(context.chat.createdAt.getTime())
        : dayjs(context.chat.createdAt).tz(context.timeZone).format(args[0]!)
    },
  },
  {
    name: "add",
    summary: "Integer addition",
    group: "transform",
    snippet: "{{add::left::right}}",
    evaluate: (args) => {
      const [left, right] = args.map(integer)
      return args.length === 2 && left != null && right != null
        ? String(left + right)
        : null
    },
  },
  {
    name: "mul",
    summary: "Integer multiplication",
    group: "transform",
    snippet: "{{mul::left::right}}",
    evaluate: (args) => {
      const [left, right] = args.map(integer)
      return args.length === 2 && left != null && right != null
        ? String(left * right)
        : null
    },
  },
  {
    name: "bitnot",
    summary: "Integer bitwise complement",
    group: "transform",
    snippet: "{{bitnot::value}}",
    evaluate: (args) => {
      const value = args.length === 1 ? integer(args[0]!) : null
      return value == null ? null : String(~value)
    },
  },
  {
    name: "hex",
    summary: "Hexadecimal integer",
    group: "transform",
    snippet: "{{hex::value}}",
    evaluate: (args) => {
      const value =
        args.length >= 1 && args.length <= 2 ? integer(args[0]!) : null
      if (value == null) return null
      if (args.length === 1) return value >= 0n ? value.toString(16) : null
      const width = integer(args[1]!)
      if (width == null || width < 1n || width > 1024n) return null
      const bits = width * 4n
      return (value & ((1n << bits) - 1n))
        .toString(16)
        .padStart(Number(width), "0")
    },
  },
  {
    name: "hash",
    summary: "SHA-256 hash",
    group: "transform",
    snippet: "{{hash::{{chatId}}::hex}}",
    evaluate: (args) => {
      if (args.length < 1 || args.length > 2) return null
      const digest = sha256(textEncoder.encode(args[0]!))
      const encoding = args[1] ?? "hex"
      if (encoding === "hex")
        return Array.from(digest, (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("")
      if (encoding === "base62") return encodeBase62(digest)
      if (encoding === "base64url")
        return btoa(String.fromCharCode(...digest))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "")
      return null
    },
  },
  {
    name: "slice",
    summary: "Slice text",
    group: "transform",
    snippet: "{{slice::value::start::end}}",
    evaluate: (args) => {
      if (args.length < 2 || args.length > 3) return null
      const start = integer(args[1]!)
      const end = args.length === 3 ? integer(args[2]!) : undefined
      if (start == null || (args.length === 3 && end == null)) return null
      return Array.from(args[0]!)
        .slice(Number(start), end == null ? undefined : Number(end))
        .join("")
    },
  },
  {
    name: "idleDuration",
    summary: "Time since the previous user turn",
    group: "time",
    evaluate: (args, context) => {
      if (!noArgs(args)) return null
      if (!context.idleSince) return "just now"
      return dayjs
        .duration(
          Math.max(0, context.now.getTime() - context.idleSince.getTime())
        )
        .humanize()
    },
  },
  {
    name: "timeDiff",
    summary: "Duration between two times",
    group: "time",
    snippet: "{{timeDiff::start::end}}",
    preview: "snippet",
    evaluate: (args, context) => {
      if (args.length !== 2) return null
      const left = parseTime(args[0]!, context)
      const right = parseTime(args[1]!, context)
      if (!left || !right) return null
      return dayjs.duration(Math.abs(left.diff(right))).humanize()
    },
  },
]

export const builtInMacroRegistry = createMacroRegistry(builtInMacroDefinitions)

type ParsedMacro = {
  raw: string
  name: string
  args: string[]
}

function findMacroEnd(text: string, start: number): number | null {
  let depth = 1
  for (let index = start + 2; index < text.length - 1; index++) {
    const pair = text.slice(index, index + 2)
    if (pair === "{{") {
      depth++
      index++
    } else if (pair === "}}") {
      depth--
      if (depth === 0) return index
      index++
    }
  }
  return null
}

function splitArgs(content: string): string[] {
  const args: string[] = []
  let depth = 0
  let segmentStart = 0
  for (let index = 0; index < content.length - 1; index++) {
    const pair = content.slice(index, index + 2)
    if (pair === "{{") {
      depth++
      index++
      continue
    }
    if (pair === "}}" && depth > 0) {
      depth--
      index++
      continue
    }
    if (pair === "::" && depth === 0) {
      args.push(content.slice(segmentStart, index).trim())
      segmentStart = index + 2
      index++
    }
  }
  args.push(content.slice(segmentStart).trim())
  return args
}

function parseMacro(raw: string): ParsedMacro | null {
  const content = raw.slice(2, -2).trim()
  if (!content) return null
  const parts = splitArgs(content)
  const name = parts.shift()?.trim()
  if (!name || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return null
  return { raw, name, args: parts }
}

function expandInternal(
  text: string,
  context: MacroContext,
  registry: MacroRegistry,
  depth: number
): string {
  if (depth >= MAX_EXPANSION_DEPTH) return text
  let result = ""
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf("{{", cursor)
    if (start < 0) return result + text.slice(cursor)
    result += text.slice(cursor, start)
    const end = findMacroEnd(text, start)
    if (end == null) return result + text.slice(start)
    const raw = text.slice(start, end + 2)
    const parsed = parseMacro(raw)
    const definition = parsed && registry.get(parsed.name.toLowerCase())
    if (!parsed || !definition) {
      result += raw
    } else {
      const args = parsed.args.map((arg) =>
        expandInternal(arg, context, registry, depth + 1)
      )
      result += definition.evaluate(args, context) ?? raw
    }
    cursor = end + 2
  }
  return result
}

export function expandPromptMacros(
  text: string,
  context?: MacroContext,
  registry: MacroRegistry = builtInMacroRegistry
): string {
  return expandInternal(text, defaultMacroContext(context ?? {}), registry, 0)
}

export function idleSinceFromPath(
  nodes: ReadonlyArray<{ role: string; created_at: string }>
): Date | undefined {
  let skippedCurrent = false
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!
    if (!skippedCurrent) {
      skippedCurrent = true
      continue
    }
    if (node.role !== "user") continue
    const timestamp = new Date(node.created_at)
    if (!Number.isNaN(timestamp.getTime())) return timestamp
  }
  return undefined
}
