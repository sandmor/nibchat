import dayjs, { type Dayjs } from "dayjs"
import advancedFormat from "dayjs/plugin/advancedFormat"
import customParseFormat from "dayjs/plugin/customParseFormat"
import duration from "dayjs/plugin/duration"
import localizedFormat from "dayjs/plugin/localizedFormat"
import relativeTime from "dayjs/plugin/relativeTime"
import timezone from "dayjs/plugin/timezone"
import utc from "dayjs/plugin/utc"

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
}

export type MacroDefinition = {
  name: string
  /** Short label for the insert picker. Falls back to `name`. */
  summary?: string
  /** Inserted text. Defaults to `{{name}}`. */
  snippet?: string
  evaluate: (args: readonly string[], context: MacroContext) => string | null
}

export type MacroRegistry = ReadonlyMap<string, MacroDefinition>

export type MacroPickerEntry = {
  name: string
  summary: string
  snippet: string
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
  }))
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
  overrides: Partial<MacroContext> = {}
): MacroContext {
  return {
    now: overrides.now ?? new Date(),
    timeZone: normalizeTimeZone(overrides.timeZone),
    ...(overrides.idleSince ? { idleSince: overrides.idleSince } : {}),
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

export const builtInMacroDefinitions: readonly MacroDefinition[] = [
  {
    name: "time",
    summary: "Local time",
    evaluate(args, context) {
      if (noArgs(args)) return current(context).format("h:mm A")
      if (args.length !== 1) return null
      return offsetTime(context, args[0]!)?.format("h:mm A") ?? null
    },
  },
  {
    name: "date",
    summary: "Local date",
    evaluate: (args, context) =>
      noArgs(args) ? current(context).format("M/D/YYYY") : null,
  },
  {
    name: "weekday",
    summary: "Weekday name",
    evaluate: (args, context) =>
      noArgs(args) ? current(context).format("dddd") : null,
  },
  {
    name: "isotime",
    summary: "24-hour time",
    evaluate: (args, context) =>
      noArgs(args) ? current(context).format("HH:mm") : null,
  },
  {
    name: "isodate",
    summary: "ISO date",
    evaluate: (args, context) =>
      noArgs(args) ? current(context).format("YYYY-MM-DD") : null,
  },
  {
    name: "datetimeformat",
    summary: "Custom format",
    snippet: "{{datetimeformat::YYYY-MM-DD HH:mm}}",
    evaluate: (args, context) =>
      args.length === 1 && args[0]!.trim()
        ? current(context).format(args[0]!)
        : null,
  },
  {
    name: "idleDuration",
    summary: "Time since the previous user turn",
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
    snippet: "{{timeDiff::{{isodate}} 09:00::{{isodate}} 17:00}}",
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
  context: MacroContext = defaultMacroContext(),
  registry: MacroRegistry = builtInMacroRegistry
): string {
  return expandInternal(text, defaultMacroContext(context), registry, 0)
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
