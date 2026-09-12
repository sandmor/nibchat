"use client"

import {
  sha256,
  type ImportConversation,
  type ImportFormatPort,
  type ImportNode,
} from "@/lib/imports/model"
import { MAX_NAME } from "@/lib/limits"

type Raw = Record<string, unknown>
const object = (value: unknown): Raw | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined
const date = (value: unknown) => {
  const parsed =
    typeof value === "number"
      ? new Date(value * 1000)
      : new Date(text(value) ?? 0)
  return Number.isNaN(parsed.valueOf())
    ? new Date(0).toISOString()
    : parsed.toISOString()
}

/** ChatGPT data-export JSON has no published schema; keep parsing defensive. */
export const chatgptFormat: ImportFormatPort = {
  id: "chatgpt",
  version: 1,
  label: "ChatGPT",
  async *conversations(archive) {
    const names = archive
      .names()
      .filter((name) => /(^|\/)conversations(?:-\d+)?\.json$/i.test(name))
      .sort()
    if (!names.length)
      throw new Error(
        "No conversations JSON was found. Select the original ChatGPT export ZIP, not chat.html."
      )
    for (const name of names) {
      for await (const raw of jsonArray(await archive.stream(name))) {
        const normalized = await normalize(raw)
        if (normalized) yield normalized
      }
    }
  },
  assetEntry(archive, id) {
    return archive
      .names()
      .find(
        (name) =>
          name === `${id}.dat` ||
          name.endsWith(`/${id}.dat`) ||
          name.includes(id)
      )
  },
}

async function normalize(raw: Raw): Promise<ImportConversation | null> {
  const mapping = object(raw.mapping)
  const sourceId = text(raw.conversation_id) ?? text(raw.id)
  if (!mapping || !sourceId) return null
  const children = new Map<string, string[]>()
  for (const [nodeId, value] of Object.entries(mapping)) {
    const parent = text(object(value)?.parent)
    if (parent) children.set(parent, [...(children.get(parent) ?? []), nodeId])
  }
  const nodes: ImportNode[] = []
  const assets = new Map<
    string,
    { id: string; name: string; mediaType: string }
  >()
  const warnings: string[] = []
  const visit = (
    nodeId: string,
    visibleParent: string | null,
    visiting: Set<string>
  ) => {
    if (visiting.has(nodeId)) {
      warnings.push("A cyclic message branch was skipped")
      return
    }
    const source = object(mapping[nodeId])
    if (!source) return
    const message = object(source.message)
    let parent = visibleParent
    if (message) {
      const author = object(message.author)
      const role = text(author?.role)
      if (
        role === "user" ||
        role === "assistant" ||
        role === "system" ||
        role === "tool"
      ) {
        const converted = parts(message, nodeId, assets, warnings)
        nodes.push({
          id: nodeId,
          parentId: visibleParent,
          selectedChildId: null,
          role,
          parts: converted.length
            ? converted
            : [{ type: "text", text: "[Unsupported ChatGPT message content]" }],
          createdAt: date(message.create_time ?? raw.create_time),
          sourceModel: text(object(message.metadata)?.model_slug)?.slice(
            0,
            256
          ),
          excluded: role === "system" || role === "tool",
        })
        parent = nodeId
      }
    }
    const next = array(source.children)
      .map(text)
      .filter((item): item is string => Boolean(item))
    const childIds = next.length ? next : (children.get(nodeId) ?? [])
    const stack = new Set(visiting)
    stack.add(nodeId)
    for (const child of childIds) visit(child, parent, stack)
  }
  const roots = Object.entries(mapping)
    .filter(([, value]) => !text(object(value)?.parent))
    .map(([key]) => key)
  for (const root of roots) visit(root, null, new Set())
  if (!nodes.length) return null
  const imported = new Map(nodes.map((node) => [node.id, node]))
  const active: string[] = []
  let cursor = text(raw.current_node)
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    if (imported.has(cursor)) active.unshift(cursor)
    cursor = text(object(mapping[cursor])?.parent)
  }
  for (let index = 0; index < active.length - 1; index++)
    imported.get(active[index]!)!.selectedChildId = active[index + 1]!
  const encoded = new TextEncoder().encode(JSON.stringify(raw))
  return {
    sourceId,
    fingerprint: await sha256(encoded),
    title: (text(raw.title)?.trim() || "Untitled ChatGPT conversation").slice(
      0,
      MAX_NAME
    ),
    createdAt: date(raw.create_time),
    updatedAt: date(raw.update_time ?? raw.create_time),
    nodeCount: nodes.length,
    selectedRootId:
      active[0] ?? nodes.find((node) => node.parentId === null)?.id ?? null,
    nodes,
    assets: [...assets.values()],
    warnings,
  }
}

function parts(
  message: Raw,
  nodeId: string,
  assets: Map<string, { id: string; name: string; mediaType: string }>,
  warnings: string[]
): ImportNode["parts"] {
  const content = object(message.content) ?? {}
  const metadata = object(message.metadata) ?? {}
  const output: ImportNode["parts"] = []
  const prose: string[] = []
  const reasoning: string[] = []
  if (text(content.content)) reasoning.push(text(content.content)!)
  for (const thought of array(content.thoughts)) {
    const value = object(thought)
    const body = text(value?.content) ?? text(value?.summary)
    if (body) reasoning.push(body)
  }
  for (const rawPart of array(content.parts)) {
    if (typeof rawPart === "string") prose.push(rawPart)
    else {
      const part = object(rawPart)
      if (text(part?.content_type) === "image_asset_pointer") {
        const id = text(part?.asset_pointer)?.split("/").at(-1)
        if (id) {
          const imageMetadata = object(part?.metadata)
          assets.set(id, {
            id,
            name: (
              text(part?.filename) ??
              text(part?.name) ??
              text(imageMetadata?.filename) ??
              text(imageMetadata?.name) ??
              `image-${id}`
            ).slice(0, 255),
            mediaType: (
              text(part?.mime_type) ??
              text(part?.media_type) ??
              text(imageMetadata?.mime_type) ??
              text(imageMetadata?.media_type) ??
              "application/octet-stream"
            ).slice(0, 128),
          })
          output.push({ type: "asset", assetId: id })
        }
      }
    }
  }
  for (const value of array(metadata.attachments)) {
    const attachment = object(value)
    const id = text(attachment?.id)
    if (!id) continue
    const asset = {
      id,
      name: (text(attachment?.name) || `attachment-${id}`).slice(0, 255),
      mediaType: (
        text(attachment?.mime_type) || "application/octet-stream"
      ).slice(0, 128),
    }
    assets.set(id, asset)
    if (!output.some((part) => part.type === "asset" && part.assetId === id))
      output.push({ type: "asset", assetId: id })
  }
  if (prose.length) output.unshift({ type: "text", text: prose.join("\n") })
  if (reasoning.length && text(object(message.author)?.role) === "assistant")
    output.push({ type: "reasoning", text: reasoning.join("\n") })
  const kind = text(content.content_type)
  if (
    kind &&
    !["text", "multimodal_text", "reasoning_recap", "thoughts"].includes(kind)
  )
    warnings.push(`Message ${nodeId} used unsupported content type ${kind}`)
  return output
}

async function* jsonArray(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<Raw> {
  const reader = stream.getReader(),
    decoder = new TextDecoder()
  let begun = false,
    value = "",
    depth = 0,
    quoted = false,
    escaped = false
  while (true) {
    const { value: chunk, done } = await reader.read()
    const source = decoder.decode(chunk, { stream: !done })
    for (const char of source) {
      if (!begun) {
        if (char === "[") begun = true
        continue
      }
      if (depth === 0) {
        if (char === "]") return
        if (char !== "{") continue
        value = "{"
        depth = 1
        quoted = false
        escaped = false
        continue
      }
      value += char
      if (quoted) {
        if (escaped) escaped = false
        else if (char === "\\") escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === "{") depth++
      else if (char === "}" && --depth === 0) {
        const parsed = object(JSON.parse(value))
        value = ""
        if (parsed) yield parsed
      }
    }
    if (done) break
  }
  throw new Error("A conversations JSON file is incomplete")
}
