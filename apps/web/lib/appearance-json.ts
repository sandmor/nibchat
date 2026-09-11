import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete"
import { json } from "@codemirror/lang-json"
import { foldGutter, foldKeymap, syntaxTree } from "@codemirror/language"
import { linter, lintKeymap, type Diagnostic } from "@codemirror/lint"
import { searchKeymap } from "@codemirror/search"
import type { EditorState, Extension, Text } from "@codemirror/state"
import { keymap, lineNumbers } from "@codemirror/view"
import { ZodError } from "zod"
import { parseAppearance } from "@/lib/appearance"
import {
  isColorValue,
  isThemeGroupId,
  PALETTE_ROLE_LABELS,
  PALETTE_ROLES,
  SURFACE_STEP_LABELS,
  SURFACE_STEPS,
  THEME_GROUPS,
  THEME_TOKENS,
  tokenByCssVar,
} from "@/lib/appearance-registry"

type JsonPath = (string | number)[]

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"]

type AppearanceJsonCursor =
  | {
      kind: "property"
      path: JsonPath
      from: number
      to: number
      quoted: boolean
      existing: string[]
    }
  | {
      kind: "value"
      path: JsonPath
      from: number
      to: number
      quoted: boolean
    }

type AppearanceJsonIssue = {
  path: JsonPath
  message: string
  severity: "error" | "warning"
  mark: "key" | "value"
}

const ROOT_PROPERTIES: Completion[] = [
  { label: "version", detail: "Document version" },
  { label: "scheme", detail: "Light or dark look" },
  { label: "density", detail: "Spacing density" },
  { label: "radius", detail: "Corner radius" },
  { label: "remoteStylesheet", detail: "Optional extra CSS URL" },
  { label: "motion", detail: "Animation" },
  { label: "messageActions", detail: "Message action chrome" },
  { label: "messageLayout", detail: "User and assistant layout" },
  { label: "modelPicker", detail: "Model picker" },
  { label: "palette", detail: "Seed colors" },
  { label: "groups", detail: "Surface groups" },
  { label: "tokens", detail: "Token overrides" },
]

const MOTION_PROPERTIES: Completion[] = [
  { label: "enabled", detail: "Animate UI" },
  { label: "durationMs", detail: "Duration in milliseconds" },
  { label: "ease", detail: "Easing" },
  { label: "reducedMotion", detail: "Reduced-motion policy" },
]

const COLOR_PROPERTIES: Completion[] = [
  { label: "ref", detail: "Palette, surface, group, or extra" },
  { label: "literal", detail: "CSS color" },
  { label: "mix", detail: "Mix two colors" },
  { label: "alpha", detail: "Opacity" },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unquote(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string
    } catch {
      return raw.slice(1, raw.endsWith('"') ? -1 : undefined)
    }
  }
  return raw
}

function propertyNameNode(property: SyntaxNode): SyntaxNode | null {
  return property.getChild("PropertyName")
}

function propertyKey(state: EditorState, property: SyntaxNode): string | null {
  const name = propertyNameNode(property)
  if (!name) return null
  return unquote(state.sliceDoc(name.from, name.to))
}

function propertyValueNode(property: SyntaxNode): SyntaxNode | null {
  for (let child = property.firstChild; child; child = child.nextSibling) {
    if (child.name === "PropertyName" || child.name === ":") continue
    return child
  }
  return null
}

function objectKeys(
  state: EditorState,
  object: SyntaxNode,
  skip?: SyntaxNode | null
): string[] {
  const keys: string[] = []
  for (let child = object.firstChild; child; child = child.nextSibling) {
    if (child.name !== "Property") continue
    const name = propertyNameNode(child)
    if (!name || name === skip) continue
    const key = propertyKey(state, child)
    if (key != null) keys.push(key)
  }
  return keys
}

function isValueNode(node: SyntaxNode): boolean {
  return (
    node.name === "Object" ||
    node.name === "Array" ||
    node.name === "String" ||
    node.name === "Number" ||
    node.name === "True" ||
    node.name === "False" ||
    node.name === "Null"
  )
}

function arrayIndex(array: SyntaxNode, descendant: SyntaxNode): number {
  let index = 0
  for (let child = array.firstChild; child; child = child.nextSibling) {
    if (!isValueNode(child)) continue
    if (
      child === descendant ||
      (child.from <= descendant.from && child.to >= descendant.to)
    ) {
      return index
    }
    index++
  }
  return index
}

function pathToNode(state: EditorState, node: SyntaxNode): JsonPath {
  const path: JsonPath = []
  for (
    let current: SyntaxNode | null = node;
    current;
    current = current.parent
  ) {
    if (current.name === "Property") {
      const key = propertyKey(state, current)
      if (key != null) path.push(key)
    } else if (current.parent?.name === "Array" && isValueNode(current)) {
      path.push(arrayIndex(current.parent, current))
    }
  }
  return path.reverse()
}

function extraIdsFromDoc(state: EditorState): string[] {
  try {
    const value: unknown = JSON.parse(state.doc.toString())
    if (!isRecord(value) || !isRecord(value.palette)) return []
    if (!Array.isArray(value.palette.extras)) return []
    return value.palette.extras.flatMap((extra) =>
      isRecord(extra) && typeof extra.id === "string" ? [extra.id] : []
    )
  } catch {
    return []
  }
}

function appearanceJsonCursor(
  state: EditorState,
  pos: number
): AppearanceJsonCursor | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1)
  while (node) {
    if (node.name === "Property") {
      const name = propertyNameNode(node)
      const colon = node.getChild(":")
      if (name && pos >= name.from && pos <= name.to) {
        const object = node.parent
        if (object?.name !== "Object") return null
        return {
          kind: "property",
          path: pathToNode(state, object),
          from: name.from,
          to: name.to,
          quoted: true,
          existing: objectKeys(state, object, name),
        }
      }
      if (colon && pos > colon.to) {
        const value = propertyValueNode(node)
        if (value && pos > value.from && pos < value.to) {
          const quoted = value.name === "String"
          return {
            kind: "value",
            path: pathToNode(state, value),
            from: quoted ? value.from + 1 : value.from,
            to: quoted ? Math.max(value.from + 1, value.to - 1) : value.to,
            quoted,
          }
        }
        if (!value || pos <= value.from) {
          return {
            kind: "value",
            path: pathToNode(state, node),
            from: pos,
            to: pos,
            quoted: false,
          }
        }
      }
    }
    if (node.name === "Object" && pos > node.from && pos < node.to) {
      return {
        kind: "property",
        path: pathToNode(state, node),
        from: pos,
        to: pos,
        quoted: false,
        existing: objectKeys(state, node),
      }
    }
    node = node.parent
  }
  return null
}

function pathEnds(path: JsonPath, ...suffix: string[]): boolean {
  if (path.length < suffix.length) return false
  return suffix.every(
    (segment, index) => path[path.length - suffix.length + index] === segment
  )
}

function isColorObjectPath(path: JsonPath): boolean {
  if (path[0] === "tokens" && path.length === 2) return true
  if (path[0] === "groups" && path.length === 3 && path[2] === "fill")
    return true
  return pathEnds(path, "from") || pathEnds(path, "onto")
}

function propertyCompletions(path: JsonPath): Completion[] {
  if (path.length === 0) return ROOT_PROPERTIES
  if (path.length === 1 && path[0] === "motion") return MOTION_PROPERTIES
  if (path.length === 1 && path[0] === "messageActions")
    return [{ label: "captions", detail: "Show action captions" }]
  if (path.length === 1 && path[0] === "modelPicker")
    return [{ label: "showIds", detail: "Show model ids" }]
  if (path.length === 1 && path[0] === "messageLayout")
    return [
      { label: "user", detail: "User messages" },
      { label: "assistant", detail: "Assistant messages" },
    ]
  if (path[0] === "messageLayout" && path.length === 2)
    return [
      { label: "align", detail: "Horizontal align" },
      { label: "maxWidthPercent", detail: "Max width" },
    ]
  if (path.length === 1 && path[0] === "palette")
    return [
      { label: "paper", detail: PALETTE_ROLE_LABELS.paper },
      { label: "ink", detail: PALETTE_ROLE_LABELS.ink },
      { label: "muted", detail: PALETTE_ROLE_LABELS.muted },
      { label: "accent", detail: PALETTE_ROLE_LABELS.accent },
      { label: "danger", detail: PALETTE_ROLE_LABELS.danger },
      { label: "extras", detail: "Named extras" },
    ]
  if (path.length === 1 && path[0] === "groups")
    return THEME_GROUPS.map((group) => ({
      label: group.id,
      detail: group.label,
    }))
  if (path[0] === "groups" && path.length === 2)
    return [
      { label: "fill", detail: "Group fill" },
      { label: "recolorText", detail: "Recolor text to the fill" },
    ]
  if (path.length === 1 && path[0] === "tokens")
    return THEME_TOKENS.map((token) => ({
      label: token.cssVar,
      detail: token.label,
    }))
  if (isColorObjectPath(path)) return COLOR_PROPERTIES
  if (pathEnds(path, "mix"))
    return [
      { label: "from", detail: "Mix from" },
      { label: "onto", detail: "Mix onto" },
      { label: "amount", detail: "Mix amount" },
    ]
  return []
}

function refCompletions(state: EditorState): Completion[] {
  return [
    ...PALETTE_ROLES.map((role) => ({
      label: role,
      detail: PALETTE_ROLE_LABELS[role],
    })),
    ...SURFACE_STEPS.map((step) => ({
      label: `surface:${step}`,
      detail: SURFACE_STEP_LABELS[step],
    })),
    ...THEME_GROUPS.map((group) => ({
      label: `group:${group.id}`,
      detail: group.label,
    })),
    ...extraIdsFromDoc(state).map((id) => ({
      label: `extra:${id}`,
      detail: "Palette extra",
    })),
  ]
}

function valueCompletions(path: JsonPath, state: EditorState): Completion[] {
  if (path.length === 1 && path[0] === "scheme")
    return [
      { label: "light", detail: "Light look" },
      { label: "dark", detail: "Dark look" },
    ]
  if (path.length === 1 && path[0] === "density")
    return [
      { label: "comfortable", detail: "Comfortable" },
      { label: "compact", detail: "Compact" },
    ]
  if (path.length === 2 && path[0] === "motion" && path[1] === "reducedMotion")
    return [
      { label: "respect", detail: "Follow the OS" },
      { label: "never", detail: "Always animate" },
      { label: "always", detail: "Never animate" },
    ]
  if (path.length === 2 && path[0] === "motion" && path[1] === "ease")
    return ["linear", "ease", "ease-in", "ease-out", "ease-in-out"].map(
      (label) => ({ label, detail: "CSS easing" })
    )
  if (path[0] === "messageLayout" && path.at(-1) === "align")
    return [
      { label: "left", detail: "Left" },
      { label: "center", detail: "Center" },
      { label: "right", detail: "Right" },
    ]
  if (path.at(-1) === "ref") return refCompletions(state)
  if (
    (path.length === 2 && path[0] === "motion" && path[1] === "enabled") ||
    (path.length === 2 &&
      path[0] === "messageActions" &&
      path[1] === "captions") ||
    (path.length === 2 && path[0] === "modelPicker" && path[1] === "showIds") ||
    (path[0] === "groups" && path.at(-1) === "recolorText")
  ) {
    return [
      { label: "true", detail: "Boolean" },
      { label: "false", detail: "Boolean" },
    ]
  }
  return []
}

function quoteIfNeeded(label: string, quoted: boolean): string {
  return quoted ? label : JSON.stringify(label)
}

function appearanceJsonOptions(
  cursor: AppearanceJsonCursor,
  state: EditorState
): Completion[] {
  if (cursor.kind === "property") {
    const existing = new Set(cursor.existing)
    return propertyCompletions(cursor.path)
      .filter((option) => !existing.has(option.label))
      .map((option) => ({
        ...option,
        apply: cursor.quoted
          ? JSON.stringify(option.label)
          : `${JSON.stringify(option.label)}: `,
      }))
  }
  return valueCompletions(cursor.path, state).map((option) => ({
    ...option,
    apply: quoteIfNeeded(option.label, cursor.quoted),
  }))
}

function appearanceJsonCompletion(context: CompletionContext) {
  const cursor = appearanceJsonCursor(context.state, context.pos)
  if (!cursor) return null
  const options = appearanceJsonOptions(cursor, context.state)
  if (!options.length) return null
  return {
    from: cursor.from,
    to: cursor.to,
    options,
    filter: true,
  }
}

function findProperty(
  state: EditorState,
  object: SyntaxNode,
  key: string
): SyntaxNode | null {
  for (let child = object.firstChild; child; child = child.nextSibling) {
    if (child.name === "Property" && propertyKey(state, child) === key)
      return child
  }
  return null
}

function arrayChild(array: SyntaxNode, index: number): SyntaxNode | null {
  let current = 0
  for (let child = array.firstChild; child; child = child.nextSibling) {
    if (!isValueNode(child)) continue
    if (current === index) return child
    current++
  }
  return null
}

function documentValue(state: EditorState): SyntaxNode | null {
  const top = syntaxTree(state).topNode
  return (
    top.getChild("Object") ??
    top.getChild("Array") ??
    top.getChild("String") ??
    top.firstChild
  )
}

function resolvePath(
  state: EditorState,
  path: JsonPath
): { name: SyntaxNode | null; value: SyntaxNode | null } | null {
  let value = documentValue(state)
  let name: SyntaxNode | null = null
  for (const segment of path) {
    if (!value) return null
    if (typeof segment === "string") {
      if (value.name !== "Object") return null
      const property = findProperty(state, value, segment)
      if (!property) return null
      name = propertyNameNode(property)
      value = propertyValueNode(property)
    } else {
      if (value.name !== "Array") return null
      name = null
      value = arrayChild(value, segment)
    }
  }
  return { name, value }
}

function rawDocumentIssues(value: unknown): AppearanceJsonIssue[] {
  if (!isRecord(value)) {
    return [
      {
        path: [],
        message: "Theme JSON must be an object",
        severity: "error",
        mark: "value",
      },
    ]
  }
  const issues: AppearanceJsonIssue[] = []
  if (value.groups != null && !isRecord(value.groups)) {
    issues.push({
      path: ["groups"],
      message: "groups must be an object",
      severity: "error",
      mark: "value",
    })
  }
  if (isRecord(value.groups)) {
    for (const [id, paint] of Object.entries(value.groups)) {
      if (!isThemeGroupId(id)) {
        issues.push({
          path: ["groups", id],
          message: `Unknown theme group: ${id}`,
          severity: "error",
          mark: "key",
        })
      }
      if (isRecord(paint) && paint.fill != null && !isColorValue(paint.fill)) {
        issues.push({
          path: ["groups", id, "fill"],
          message: "Expected a color value ({ ref }, { literal }, or { mix })",
          severity: "error",
          mark: "value",
        })
      }
    }
  }
  if (value.tokens != null && !isRecord(value.tokens)) {
    issues.push({
      path: ["tokens"],
      message: "tokens must be an object",
      severity: "error",
      mark: "value",
    })
  }
  if (isRecord(value.tokens)) {
    for (const [cssVar, color] of Object.entries(value.tokens)) {
      if (!tokenByCssVar(cssVar)) {
        issues.push({
          path: ["tokens", cssVar],
          message: `Unknown token: ${cssVar}`,
          severity: "warning",
          mark: "key",
        })
      }
      if (!isColorValue(color)) {
        issues.push({
          path: ["tokens", cssVar],
          message: "Expected a color value ({ ref }, { literal }, or { mix })",
          severity: "error",
          mark: "value",
        })
      }
    }
  }
  return issues
}

function schemaIssues(value: unknown): AppearanceJsonIssue[] {
  const issues = rawDocumentIssues(value)
  try {
    parseAppearance(value)
  } catch (error) {
    if (error instanceof ZodError) {
      for (const issue of error.issues) {
        issues.push({
          path: issue.path.filter(
            (segment): segment is string | number =>
              typeof segment === "string" || typeof segment === "number"
          ),
          message: issue.message,
          severity: "error",
          mark: "value",
        })
      }
    } else if (error instanceof Error) {
      issues.push({
        path: [],
        message: error.message,
        severity: "error",
        mark: "value",
      })
    }
  }
  return issues
}

function errorPosition(error: SyntaxError, doc: Text): number {
  const position = error.message.match(/at position (\d+)/)
  if (position) return Math.min(Number(position[1]), doc.length)
  const lineColumn = error.message.match(/at line (\d+) column (\d+)/)
  if (lineColumn) {
    return Math.min(
      doc.line(Number(lineColumn[1])).from + Number(lineColumn[2]) - 1,
      doc.length
    )
  }
  return 0
}

function issueRange(
  state: EditorState,
  issue: AppearanceJsonIssue
): { from: number; to: number } | null {
  if (issue.path.length === 0) {
    const value = documentValue(state)
    return value
      ? { from: value.from, to: value.to }
      : { from: 0, to: state.doc.length }
  }
  const resolved = resolvePath(state, issue.path)
  if (!resolved) return null
  if (issue.mark === "key" && resolved.name) {
    return { from: resolved.name.from, to: resolved.name.to }
  }
  const node = resolved.value ?? resolved.name
  return node ? { from: node.from, to: node.to } : null
}

function appearanceJsonDiagnostics(state: EditorState): Diagnostic[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(state.doc.toString())
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    const pos = errorPosition(error, state.doc)
    return [
      {
        from: pos,
        to: pos,
        severity: "error",
        message: error.message,
      },
    ]
  }
  return schemaIssues(parsed).flatMap((issue) => {
    const range = issueRange(state, issue)
    if (!range) return []
    return [
      {
        from: range.from,
        to: range.to,
        severity: issue.severity,
        message: issue.message,
      },
    ]
  })
}

/** Short status for the collapsible chip; null when the document applies. */
export function appearanceJsonParseError(text: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return "Invalid JSON"
  }
  try {
    parseAppearance(parsed)
    return null
  } catch (error) {
    if (error instanceof ZodError)
      return error.issues[0]?.message ?? "Invalid theme document"
    return error instanceof Error ? error.message : "Invalid theme document"
  }
}

/** Language, completion, lint, fold, search, and line numbers for theme JSON. */
export function appearanceJsonExtensions(): Extension[] {
  return [
    json(),
    lineNumbers(),
    foldGutter(),
    closeBrackets(),
    keymap.of([
      ...closeBracketsKeymap,
      ...foldKeymap,
      ...searchKeymap,
      ...lintKeymap,
    ]),
    autocompletion({
      icons: false,
      override: [appearanceJsonCompletion],
    }),
    linter((view) => appearanceJsonDiagnostics(view.state), { delay: 250 }),
  ]
}
