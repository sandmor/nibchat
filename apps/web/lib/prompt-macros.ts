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
const MAX_EXPANSION_DEPTH = 32
const UTC_OFFSET = /^UTC([+-])(\d{1,2})(?::([0-5]\d))?$/i
const LOCAL_DATE_TIME_FORMATS = [
  "YYYY-MM-DD HH:mm:ss",
  "YYYY-MM-DD HH:mm",
  "YYYY-MM-DD",
]
const TOKEN_RE =
  /^(\d+|[A-Za-z_][A-Za-z0-9_]*|==|!=|<=|>=|&&|\|\||[().,!+*\-<>])/
const COMPARE_OPS = new Set(["==", "!=", "<", "<=", ">", ">="])
const FALSY_STRING = /^(false|off|0)$/i

export type PromptVariableValue = string | boolean

export type MacroContext = {
  now: Date
  timeZone: string
  /** The user message preceding the currently generated turn, when available. */
  idleSince?: Date
  /** Stable chat identity, when rendering a conversation-scoped value. */
  chat?: { id: string; createdAt: Date }
  /** Prompt-stack variables resolved for this conversation. */
  variables?: Readonly<Record<string, PromptVariableValue>>
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

/** True when expansion needs a conversation, not just the current time. */
export function valueNeedsChatContext(value: string): boolean {
  return /\b(chatId|chatCreatedAt)\b/.test(value)
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
  now: Date = new Date(),
  variables?: MacroContext["variables"]
): MacroContext {
  return defaultMacroContext({
    now,
    timeZone,
    idleSince: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    chat: SAMPLE_MACRO_CHAT,
    ...(variables ? { variables } : {}),
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

export type MacroLogicPickerEntry = {
  name: string
  summary: string
  snippet: string
  preview: string
}

export const MACRO_LOGIC_GROUP_LABEL = "Logic"

/** Insertable {{if}} / {{else}} / {{/if}} scaffold. Not a registered macro. */
export function macroLogicPickerEntries(
  variables: ReadonlyArray<{ name: string }> = [],
  options?: { block?: boolean }
): MacroLogicPickerEntry[] {
  const name = variables.find((variable) => variable.name.trim())?.name.trim()
  const condition = name ? `vars.${name}` : "true"
  const snippet = options?.block
    ? `{{if ${condition}}}\n\n{{else}}\n\n{{/if}}`
    : `{{if ${condition}}}...{{else}}...{{/if}}`
  return [
    {
      name: "if",
      summary: "vars.name, &&, ||, ==",
      snippet,
      preview: "{{if}} … {{else}} … {{/if}}",
    },
  ]
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
    ...(src.variables ? { variables: src.variables } : {}),
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
    snippet: '{{datetimeformat("YYYY-MM-DD HH:mm")}}',
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
    snippet: "{{add(1, 2)}}",
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
    snippet: "{{mul(2, 4096)}}",
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
    snippet: "{{bitnot(1)}}",
    evaluate: (args) => {
      const value = args.length === 1 ? integer(args[0]!) : null
      return value == null ? null : String(~value)
    },
  },
  {
    name: "hex",
    summary: "Hexadecimal integer",
    group: "transform",
    snippet: "{{hex(255)}}",
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
    snippet: '{{hash(chatId, "hex")}}',
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
    snippet: "{{slice(value, 0, 14)}}",
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
    snippet: '{{timeDiff("2026-01-01", "2026-01-02")}}',
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

type ExprValue = string | boolean | bigint

type Token = {
  kind: string
  value?: string
}

function lex(source: string): Token[] | null {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    if (/\s/.test(source[index]!)) {
      index++
      continue
    }
    const quote = source[index]
    if (quote === '"' || quote === "'") {
      let value = ""
      index++
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\" && index + 1 < source.length) {
          index++
          value += source[index]
        } else {
          value += source[index]
        }
        index++
      }
      if (source[index] !== quote) return null
      index++
      tokens.push({ kind: "str", value })
      continue
    }
    const match = TOKEN_RE.exec(source.slice(index))
    if (!match) return null
    const text = match[0]!
    const kind = /^\d+$/.test(text)
      ? "num"
      : /^[A-Za-z_]/.test(text)
        ? "id"
        : text
    tokens.push({ kind, value: text })
    index += text.length
  }
  tokens.push({ kind: "end" })
  return tokens
}

function isTruthy(value: ExprValue): boolean {
  if (value === false || value === 0n) return false
  if (typeof value === "string" && (value === "" || FALSY_STRING.test(value)))
    return false
  return true
}

function stringify(value: ExprValue): string {
  return String(value)
}

class ExpressionParser {
  private index = 0

  constructor(
    private readonly tokens: Token[],
    private readonly context: MacroContext,
    private readonly registry: MacroRegistry
  ) {}

  evaluate(): ExprValue | null {
    try {
      const value = this.parseOr()
      return this.peek("end") ? value : null
    } catch {
      return null
    }
  }

  private peek(kind: string): boolean {
    return this.tokens[this.index]?.kind === kind
  }

  private take(kind: string): Token {
    if (!this.peek(kind)) throw new Error("unexpected token")
    return this.tokens[this.index++]!
  }

  private currentKind(): string {
    return this.tokens[this.index]?.kind ?? "end"
  }

  private parseOr(): ExprValue {
    let left = this.parseAnd()
    while (this.peek("||")) {
      this.index++
      const right = this.parseAnd()
      left = isTruthy(left) || isTruthy(right)
    }
    return left
  }

  private parseAnd(): ExprValue {
    let left = this.parseCompare()
    while (this.peek("&&")) {
      this.index++
      const right = this.parseCompare()
      left = isTruthy(left) && isTruthy(right)
    }
    return left
  }

  private parseCompare(): ExprValue {
    let left = this.parseAdd()
    while (COMPARE_OPS.has(this.currentKind())) {
      const op = this.tokens[this.index++]!.kind
      const right = this.parseAdd()
      let matched: boolean
      if (op === "==" || op === "!=") {
        matched = typeof left === typeof right && left === right
      } else {
        const a = integer(stringify(left))
        const b = integer(stringify(right))
        if (a == null || b == null) throw new Error("non-integer compare")
        matched =
          op === "<"
            ? a < b
            : op === "<="
              ? a <= b
              : op === ">"
                ? a > b
                : a >= b
      }
      left = op === "!=" ? !matched : matched
    }
    return left
  }

  private parseAdd(): ExprValue {
    let left = this.parseMul()
    while (this.peek("+") || this.peek("-")) {
      const op = this.tokens[this.index++]!.kind
      const right = this.parseMul()
      const a = integer(stringify(left))
      const b = integer(stringify(right))
      if (a == null || b == null) throw new Error("non-integer arithmetic")
      left = op === "+" ? a + b : a - b
    }
    return left
  }

  private parseMul(): ExprValue {
    let left = this.parseUnary()
    while (this.peek("*")) {
      this.index++
      const right = this.parseUnary()
      const a = integer(stringify(left))
      const b = integer(stringify(right))
      if (a == null || b == null) throw new Error("non-integer arithmetic")
      left = a * b
    }
    return left
  }

  private parseUnary(): ExprValue {
    if (this.peek("!")) {
      this.index++
      return !isTruthy(this.parseUnary())
    }
    if (this.peek("-")) {
      this.index++
      const value = integer(stringify(this.parseUnary()))
      if (value == null) throw new Error("non-integer negation")
      return -value
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ExprValue {
    if (this.peek("num")) return BigInt(this.take("num").value!)
    if (this.peek("str")) return this.take("str").value!
    if (this.peek("(")) {
      this.index++
      const value = this.parseOr()
      this.take(")")
      return value
    }
    const name = this.take("id").value!
    if (name === "true") return true
    if (name === "false") return false
    if (name === "vars") {
      this.take(".")
      const key = this.take("id").value!
      return this.context.variables?.[key] ?? ""
    }
    if (this.peek("(")) {
      this.index++
      const args: string[] = []
      if (!this.peek(")")) {
        while (true) {
          args.push(stringify(this.parseOr()))
          if (!this.peek(",")) break
          this.index++
        }
      }
      this.take(")")
      const result = this.registry
        .get(name.toLowerCase())
        ?.evaluate(args, this.context)
      if (result == null) throw new Error("macro failed")
      return result
    }
    const result = this.registry
      .get(name.toLowerCase())
      ?.evaluate([], this.context)
    if (result == null) throw new Error("macro failed")
    return result
  }
}

function evaluateExpression(
  source: string,
  context: MacroContext,
  registry: MacroRegistry
): ExprValue | null {
  const tokens = lex(source)
  if (!tokens) return null
  return new ExpressionParser(tokens, context, registry).evaluate()
}

function findMacroEnd(text: string, contentStart: number): number {
  let depth = 1
  let quote: string | null = null
  for (let index = contentStart; index < text.length; index++) {
    const char = text[index]
    if (quote !== null) {
      if (char === "\\") index++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (char === "{" && text[index + 1] === "{") {
      depth++
      index++
    } else if (char === "}" && text[index + 1] === "}") {
      if (--depth === 0) return index
      index++
    }
  }
  return -1
}

type IfBlock = {
  elseStart: number
  elseAfter: number
  endStart: number
  afterEnd: number
}

function findIfBlock(text: string, afterOpen: number): IfBlock | null {
  let cursor = afterOpen
  let depth = 1
  let elseStart = -1
  let elseAfter = -1
  while (cursor < text.length) {
    const start = text.indexOf("{{", cursor)
    if (start < 0) return null
    const end = findMacroEnd(text, start + 2)
    if (end < 0) return null
    const tag = text.slice(start + 2, end).trim()
    if (tag.startsWith("if ")) depth++
    else if (tag === "/if" && --depth === 0) {
      return { elseStart, elseAfter, endStart: start, afterEnd: end + 2 }
    } else if (tag === "else" && depth === 1) {
      elseStart = start
      elseAfter = end + 2
    }
    cursor = end + 2
  }
  return null
}

function renderTemplate(
  text: string,
  context: MacroContext,
  registry: MacroRegistry,
  depth = 0
): string {
  if (depth > MAX_EXPANSION_DEPTH) return text
  let result = ""
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf("{{", cursor)
    if (start < 0) return result + text.slice(cursor)
    result += text.slice(cursor, start)
    const end = findMacroEnd(text, start + 2)
    if (end < 0) return result + text.slice(start)
    const inner = text.slice(start + 2, end).trim()
    if (inner.startsWith("if ")) {
      const block = findIfBlock(text, end + 2)
      const condition = evaluateExpression(inner.slice(3), context, registry)
      if (!block || condition == null) {
        result += block
          ? text.slice(start, block.afterEnd)
          : text.slice(start, end + 2)
        cursor = block ? block.afterEnd : end + 2
        continue
      }
      const yesEnd = block.elseStart < 0 ? block.endStart : block.elseStart
      const branch = isTruthy(condition)
        ? text.slice(end + 2, yesEnd)
        : block.elseStart < 0
          ? ""
          : text.slice(block.elseAfter, block.endStart)
      result += renderTemplate(branch, context, registry, depth + 1)
      cursor = block.afterEnd
      continue
    }
    if (inner === "else" || inner === "/if") {
      result += text.slice(start, end + 2)
      cursor = end + 2
      continue
    }
    const value = evaluateExpression(inner, context, registry)
    result += value == null ? text.slice(start, end + 2) : String(value)
    cursor = end + 2
  }
  return result
}

export function expandPromptMacros(
  text: string,
  context?: MacroContext,
  registry: MacroRegistry = builtInMacroRegistry
): string {
  return renderTemplate(text, defaultMacroContext(context), registry)
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
