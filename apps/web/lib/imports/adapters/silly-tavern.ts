"use client"

import {
  sha256,
  type ImportArchivePort,
  type ImportEntity,
  type ImportFormatPort,
  type ImportNode,
} from "@/lib/imports/model"
import {
  MAX_COLLECTION,
  MAX_ID,
  MAX_NAME,
  MAX_PROMPT_CHARS,
} from "@/lib/limits"
import { readArchiveEntry } from "./browser-archive"

type Raw = Record<string, unknown>
type Group = { id: string; name: string; chats: string[]; members: string[] }
type Card = { key: string; entity: ImportEntity }

const object = (value: unknown): Raw | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null
const text = (value: unknown) => (typeof value === "string" ? value : undefined)
const array = (value: unknown) => (Array.isArray(value) ? value : [])
const safe = (value: string, max = MAX_PROMPT_CHARS) => value.slice(0, max)

function iso(value: unknown, fallback = new Date(0).toISOString()) {
  const source = typeof value === "number" ? value : text(value)
  if (source === undefined) return fallback
  const parsed = new Date(source)
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed.toISOString()
}

function base(name: string) {
  return (
    name
      .split("/")
      .at(-1)
      ?.replace(/\.jsonl$/i, "") ?? name
  )
}

/** Full ST backups contain historical copies too. Only import the live chat
 * folders; a bare JSONL file is the supported standalone-chat form. */
function isChatEntry(name: string) {
  if (!name.toLowerCase().endsWith(".jsonl")) return false
  if (!name.includes("/")) return true
  return (
    /(^|\/)chats\/[^/]+\/[^/]+\.jsonl$/i.test(name) ||
    /(^|\/)group chats\/[^/]+\.jsonl$/i.test(name)
  )
}

/** Live cards live under characters/. Loose PNG picks from the file dialog
 * are also cards; zip internals such as user/images are not. */
function isCharacterCard(name: string) {
  const lower = name.toLowerCase()
  if (!lower.endsWith(".png")) return false
  if (/(^|\/)characters\/[^/]+\.png$/.test(lower)) return true
  return !name.includes("/")
}

function cardFields(raw: Raw) {
  const data = object(raw.data) ?? raw
  const fields: Record<string, string> = {}
  const copy = (target: string, source: string) => {
    const value = text(data[source])?.trim()
    if (value) fields[target] = safe(value)
  }
  copy("character_name", "name")
  copy("character_description", "description")
  copy("character_personality", "personality")
  copy("scenario", "scenario")
  copy("example_dialogue", "mes_example")
  copy("system_prompt", "system_prompt")
  copy("post_history_instructions", "post_history_instructions")
  return { fields, data }
}

/** A deliberately small browser PNG tEXt reader. ST cards use base64 in
 * chara/ccv3 chunks; no image pixels are retained by this importer. */
export function sillyTavernCardJson(bytes: Uint8Array): Raw | null {
  if (bytes.length < 8 || bytes[0] !== 137 || bytes[1] !== 80) return null
  const decoder = new TextDecoder()
  let cursor = 8
  let v2: string | undefined
  let v3: string | undefined
  while (cursor + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + cursor)
    const length = view.getUint32(0)
    if (length > bytes.length - cursor - 12) return null
    const type = decoder.decode(bytes.subarray(cursor + 4, cursor + 8))
    if (type === "tEXt") {
      const data = bytes.subarray(cursor + 8, cursor + 8 + length)
      const split = data.indexOf(0)
      if (split > 0) {
        const key = decoder.decode(data.subarray(0, split)).toLowerCase()
        const value = decoder.decode(data.subarray(split + 1))
        if (key === "chara") v2 = value
        if (key === "ccv3") v3 = value
      }
    }
    if (type === "IEND") break
    cursor += length + 12
  }
  try {
    const encoded = v3 ?? v2
    if (!encoded) return null
    const binary = atob(encoded)
    const decoded = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++)
      decoded[index] = binary.charCodeAt(index)
    return object(JSON.parse(new TextDecoder().decode(decoded)))
  } catch {
    return null
  }
}

async function textEntry(archive: ImportArchivePort, name: string) {
  return new TextDecoder().decode(await readArchiveEntry(archive, name))
}

function mediaType(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase()
  return (
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        pdf: "application/pdf",
        txt: "text/plain",
        md: "text/markdown",
        json: "application/json",
        csv: "text/csv",
      } as Record<string, string>
    )[extension ?? ""] ?? "application/octet-stream"
  )
}

function sourceAsset(archive: ImportArchivePort, value: string) {
  let clean: string
  try {
    clean = decodeURIComponent(value.split(/[?#]/, 1)[0] ?? "").replace(
      /^\/+/,
      ""
    )
  } catch {
    return undefined
  }
  if (!clean || /^https?:/i.test(value) || value.startsWith("data:"))
    return undefined
  return archive
    .names()
    .find((name) => name === clean || name.endsWith(`/${clean}`))
}

function assistantNames(messages: Raw[]) {
  return new Set(
    messages
      .filter((message) => !message.is_user && !message.is_system)
      .map((message) => text(message.name)?.trim())
      .filter((name): name is string => Boolean(name))
  )
}

function entityForStandalone(
  messages: Raw[],
  filename: string,
  conversationId: string
): ImportEntity {
  const assistants = assistantNames(messages)
  const label =
    assistants.size === 1 ? [...assistants][0]! : "Unassociated chats"
  return {
    id: `standalone:${conversationId}`,
    aliases: [
      ...(assistants.size === 1 ? [`inferred:${label}`] : []),
      `unassociated:${filename}`,
    ],
    label: label.slice(0, MAX_NAME),
    kind: "unassociated",
    metadata: { source: "standalone-jsonl", inferred: assistants.size === 1 },
  }
}

function groupEntity(group: Group): ImportEntity {
  return {
    id: `group:${group.id}`,
    label: group.name.slice(0, MAX_NAME),
    kind: "group",
    metadata: {
      source: "sillytavern",
      groupId: group.id,
      members: group.members,
    },
  }
}

function bindEntity(
  messages: Raw[],
  filename: string,
  conversationId: string,
  characterKey: string | undefined,
  cards: Map<string, Card>,
  group: Group | undefined
): ImportEntity {
  if (group) return groupEntity(group)
  if (characterKey && cards.has(characterKey))
    return cards.get(characterKey)!.entity
  const assistants = assistantNames(messages)
  const filenameKey = base(filename)
  const matches = [...cards.values()].filter(
    (card) =>
      assistants.has(card.entity.label) ||
      assistants.has(card.key) ||
      card.key === filenameKey
  )
  if (matches.length === 1) return matches[0]!.entity
  return entityForStandalone(messages, filename, conversationId)
}

type Catalog = {
  groups: Group[]
  cards: Map<string, Card>
  unreadableCards: Set<string>
  malformedGroupDefinition: boolean
}

const catalogs = new WeakMap<ImportArchivePort, Promise<Catalog>>()

function catalog(archive: ImportArchivePort) {
  let pending = catalogs.get(archive)
  if (!pending) {
    pending = loadCatalog(archive)
    catalogs.set(archive, pending)
  }
  return pending
}

async function loadCatalog(archive: ImportArchivePort): Promise<Catalog> {
  const groups: Group[] = []
  let malformedGroupDefinition = false
  for (const name of archive
    .names()
    .filter((entry) => /(^|\/)groups\/[^/]+\.json$/i.test(entry))) {
    try {
      const parsed = object(JSON.parse(await textEntry(archive, name)))
      if (parsed && text(parsed.id))
        groups.push({
          id: text(parsed.id)!,
          name: text(parsed.name) ?? "Untitled group",
          chats: array(parsed.chats).map(String),
          members: array(parsed.members).map(String),
        })
    } catch {
      malformedGroupDefinition = true
    }
  }
  const cards = new Map<string, Card>()
  const unreadableCards = new Set<string>()
  for (const name of archive.names().filter(isCharacterCard)) {
    const bytes = await readArchiveEntry(archive, name)
    const parsed = sillyTavernCardJson(bytes)
    const key = base(name).replace(/\.png$/i, "")
    if (!parsed) {
      unreadableCards.add(key)
      continue
    }
    const { fields, data } = cardFields(parsed)
    const created = text(parsed.create_date)
    const identity = await sha256(
      new TextEncoder().encode(
        created ? `created:${created}` : `card:${JSON.stringify(parsed)}`
      )
    )
    cards.set(key, {
      key,
      entity: {
        id: `character:${identity}`,
        aliases: [`character:${key}`],
        label: (fields.character_name ?? key).slice(0, MAX_NAME),
        kind: "character",
        ...(Object.keys(fields).length ? { variables: fields } : {}),
        metadata: {
          source: "sillytavern",
          characterId: key,
        },
        ...characterTemplate(data),
      },
    })
  }
  return { groups, cards, unreadableCards, malformedGroupDefinition }
}

function characterTemplate(data: Raw) {
  const beginnings = [
    text(data.first_mes),
    ...array(data.alternate_greetings).map((value) =>
      typeof value === "string" ? value : undefined
    ),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .slice(0, MAX_COLLECTION)
    .map((value) => safe(value))
  if (!beginnings.length) return {}
  const unsupported = new Set<string>()
  for (const beginning of beginnings) {
    for (const match of beginning.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
      const macro = match[1]!.toLowerCase()
      if (
        macro !== "char" &&
        macro !== "character" &&
        macro !== "character_name"
      )
        unsupported.add(macro)
    }
  }
  return {
    chatTemplate: {
      beginnings,
      warnings: [...unsupported].map(
        (macro) => `The SillyTavern macro {{${macro}}} was kept literally.`
      ),
    },
  }
}

function chatVariables(metadata: Raw, warnings: string[]) {
  const values: Record<string, string | boolean> = {}
  const source = object(metadata.variables)
  if (!source) return values
  for (const [name, value] of Object.entries(source)) {
    if (Object.keys(values).length >= MAX_COLLECTION) {
      warnings.push("Skipped extra chat variables")
      break
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      warnings.push(`Skipped invalid chat variable ${name}`)
      continue
    }
    if (typeof value === "boolean") values[name] = value
    else if (typeof value === "string") values[name] = safe(value)
    else warnings.push(`Skipped non-string chat variable ${name}`)
  }
  return values
}

function messageNodes(
  messages: Raw[],
  archive: ImportArchivePort,
  warnings: string[]
) {
  const nodes: ImportNode[] = []
  const assets = new Map<
    string,
    { id: string; name: string; mediaType: string }
  >()
  let previous: ImportNode | undefined
  let selectedRootId: string | null = null
  const attachment = (
    url: string,
    parts: ImportNode["parts"],
    label?: string
  ) => {
    const entry = sourceAsset(archive, url)
    if (!entry) {
      warnings.push(`Attachment unavailable: ${label ?? url}`)
      return
    }
    assets.set(entry, {
      id: entry,
      name: label ?? base(entry),
      mediaType: mediaType(entry),
    })
    parts.push({ type: "asset", assetId: entry })
  }
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!
    const extra = object(message.extra) ?? {}
    const extraType = text(extra.type)
    const narrator = extraType === "narrator"
    const role = narrator ? "system" : message.is_user ? "user" : "assistant"
    const excluded =
      extraType === "comment" || (Boolean(message.is_system) && !narrator)
    const swipes =
      role === "assistant" &&
      array(message.swipes).every((value) => typeof value === "string") &&
      array(message.swipes).length
        ? array(message.swipes).map((value) => String(value))
        : [text(message.mes) ?? ""]
    let selected = typeof message.swipe_id === "number" ? message.swipe_id : 0
    if (selected < 0 || selected >= swipes.length) selected = 0
    if ((text(message.mes) ?? "") !== swipes[selected])
      swipes[selected] = text(message.mes) ?? ""
    const swipeInfo = array(message.swipe_info)
    const alternatives: ImportNode[] = []
    for (let swipe = 0; swipe < swipes.length; swipe++) {
      const info = object(swipeInfo[swipe]) ?? {}
      // ST snapshots the selected message extra into each swipe_info entry.
      // If old data lacks that snapshot, only the selected swipe can safely
      // inherit the live message extra.
      const swipeExtra = object(info.extra) ?? (swipe === selected ? extra : {})
      const parts: ImportNode["parts"] = []
      const body = swipes[swipe] || "[Empty SillyTavern message]"
      parts.push({ type: "text", text: body })
      const reasoning = text(swipeExtra.reasoning)
      if (role === "assistant" && reasoning)
        parts.push({ type: "reasoning", text: reasoning })
      const files = [
        ...array(swipeExtra.files),
        ...(object(swipeExtra.file) ? [swipeExtra.file] : []),
      ]
      for (const file of files) {
        const item = object(file)
        const inline = text(item?.text)
        if (inline)
          parts.push({
            type: "text",
            text: `[${text(item?.name) ?? "Attachment"}]\n${inline}`,
          })
        else if (text(item?.url))
          attachment(text(item?.url)!, parts, text(item?.name))
      }
      const mediaItems = [
        ...array(swipeExtra.media),
        ...(text(swipeExtra.image) ? [{ url: swipeExtra.image }] : []),
        ...(text(swipeExtra.video) ? [{ url: swipeExtra.video }] : []),
        ...array(swipeExtra.image_swipes).map((url) => ({ url })),
      ]
      for (const media of mediaItems) {
        const item = object(media)
        if (text(item?.url))
          attachment(text(item?.url)!, parts, text(item?.title))
      }
      const name = text(message.name)?.trim()
      const avatar = text(message.original_avatar) ?? text(message.force_avatar)
      const node: ImportNode = {
        id: `m${index}s${swipe}`,
        parentId: previous?.id ?? null,
        selectedChildId: null,
        role,
        parts,
        createdAt: iso(info.send_date ?? message.send_date),
        sourceModel: text(swipeExtra.model) ?? text(extra.model),
        ...(name
          ? {
              speaker: {
                name: name.slice(0, MAX_NAME),
                ...(avatar ? { sourceAvatarId: avatar.slice(0, MAX_ID) } : {}),
              },
            }
          : {}),
        excluded,
      }
      nodes.push(node)
      alternatives.push(node)
    }
    const active = alternatives[selected]!
    if (previous) previous.selectedChildId = active.id
    else selectedRootId = active.id
    previous = active
  }
  return { nodes, assets: [...assets.values()], selectedRootId }
}

export const sillyTavernFormat: ImportFormatPort = {
  id: "sillytavern",
  version: 1,
  label: "SillyTavern",
  async *conversations(archive) {
    const { groups, cards, unreadableCards, malformedGroupDefinition } =
      await catalog(archive)
    const names = archive.names().filter(isChatEntry)
    for (const name of names) {
      const raw = await readArchiveEntry(archive, name)
      const warnings: string[] = []
      const lines = new TextDecoder()
        .decode(raw)
        .split(/\r?\n/)
        .filter((line) => line.trim())
      const parsed: Raw[] = []
      for (const [lineIndex, line] of lines.entries()) {
        try {
          const value = object(JSON.parse(line))
          if (value) parsed.push(value)
        } catch {
          warnings.push(`Malformed JSONL line ${lineIndex + 1} was skipped`)
        }
      }
      if (!parsed.length) continue
      const header = object(parsed[0])
      const metadata = object(header?.chat_metadata) ?? {}
      const messages =
        header && Object.hasOwn(header, "chat_metadata")
          ? parsed.slice(1)
          : parsed
      if (!messages.length) continue
      const fingerprint = await sha256(raw)
      const legacySourceId = `path:${name}`.slice(0, MAX_ID)
      const integrity = text(metadata.integrity)?.trim()
      const sourceId = integrity
        ? `integrity:${integrity}`
        : `content:${fingerprint}`
      const group = groups.find((item) => item.chats.includes(base(name)))
      const characterKey = /(?:^|\/)chats\/([^/]+)\//i.exec(name)?.[1]
      if (malformedGroupDefinition && /(^|\/)group chats\//i.test(name))
        warnings.push(
          "A group definition could not be read; group association may be missing"
        )
      if (characterKey && unreadableCards.has(characterKey))
        warnings.push(`Character card ${characterKey} could not be read`)
      if (characterKey && !cards.has(characterKey))
        warnings.push(`No usable character card was found for ${characterKey}`)
      if (!group && /(^|\/)group chats\//i.test(name))
        warnings.push("No group definition references this group chat")
      const entity = bindEntity(
        messages,
        name,
        sourceId,
        characterKey,
        cards,
        group
      )
      const graph = messageNodes(messages, archive, warnings)
      if (!graph.nodes.length) continue
      const dates = graph.nodes
        .map((node) => node.createdAt)
        .filter((value) => value !== new Date(0).toISOString())
      yield {
        sourceId,
        ...(sourceId !== legacySourceId
          ? { sourceAliases: [legacySourceId] }
          : {}),
        fingerprint,
        title: base(name).slice(0, MAX_NAME),
        createdAt: dates[0] ?? new Date(0).toISOString(),
        updatedAt: dates.at(-1) ?? new Date(0).toISOString(),
        nodeCount: graph.nodes.length,
        selectedRootId: graph.selectedRootId,
        variables: chatVariables(metadata, warnings),
        nodes: graph.nodes,
        assets: graph.assets,
        warnings,
        entity,
      }
    }
  },
  async *entities(archive) {
    const { cards, groups } = await catalog(archive)
    for (const card of cards.values()) yield card.entity
    for (const group of groups) yield groupEntity(group)
  },
  assetEntry(archive, id) {
    return archive.names().includes(id) ? id : undefined
  },
}
