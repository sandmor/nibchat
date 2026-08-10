import "server-only"
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client"
import { dynamicTool, jsonSchema, type ToolSet } from "ai"
import { z } from "zod"
import { db, databaseKind } from "@/lib/db"
import { id, now, parseJson } from "@/lib/domain"
import {
  MAX_ATTACHMENT_TEXT_CHARS,
  type AttachmentPart,
  type AttachmentReference,
} from "@/lib/types"

/** SQLite drivers reject JS booleans; Postgres wants real booleans. */
function toDbBool(value: boolean): boolean {
  if (databaseKind === "sqlite") return (value ? 1 : 0) as unknown as boolean
  return value
}

function fromDbBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1"
}

/** Matches `${ENV_NAME}` template tokens inside header/env values. */
export const ENV_TEMPLATE_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

const kvEntryRawSchema = z.object({
  name: z.string().min(1).max(200),
  value: z.string().max(10_000).optional(),
  /** @deprecated Migrated to `${valueEnv}` templates on read. */
  valueEnv: z.string().min(1).max(200).optional(),
})

export const mcpKvEntrySchema = z.object({
  name: z.string().min(1).max(200),
  /** May embed `${ENV_NAME}` templates. Omit/empty on update keeps stored secret. */
  value: z.string().max(10_000).optional(),
})

export type McpKvEntry = z.infer<typeof mcpKvEntrySchema>

/** Convert legacy `valueEnv` rows and strip deprecated fields. */
export function normalizeKvEntry(
  raw: z.infer<typeof kvEntryRawSchema>
): McpKvEntry {
  if (
    raw.valueEnv &&
    (raw.value == null || raw.value === "") &&
    !/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(raw.value ?? "")
  ) {
    return { name: raw.name, value: `\${${raw.valueEnv}}` }
  }
  return {
    name: raw.name,
    ...(raw.value != null ? { value: raw.value } : {}),
  }
}

export function normalizeKvEntries(raw: unknown): McpKvEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const parsed = kvEntryRawSchema.safeParse(item)
    if (!parsed.success) return []
    return [normalizeKvEntry(parsed.data)]
  })
}

function preprocessKvArray(value: unknown) {
  return normalizeKvEntries(value)
}

export const httpConfigSchema = z.object({
  url: z.string().url(),
  headers: z.preprocess(preprocessKvArray, z.array(mcpKvEntrySchema).max(100)),
  followRedirects: z.boolean().default(false),
  connectTimeoutMs: z.number().int().min(500).max(120_000).default(10_000),
  callTimeoutMs: z.number().int().min(500).max(600_000).default(60_000),
})

export const stdioConfigSchema = z.object({
  command: z.string().min(1).max(500),
  args: z.array(z.string().max(2_000)).max(100).default([]),
  cwd: z.string().max(2_000).optional(),
  env: z.preprocess(preprocessKvArray, z.array(mcpKvEntrySchema).max(100)),
  connectTimeoutMs: z.number().int().min(500).max(120_000).default(10_000),
  callTimeoutMs: z.number().int().min(500).max(600_000).default(60_000),
})

export type McpHttpConfig = z.infer<typeof httpConfigSchema>
export type McpStdioConfig = z.infer<typeof stdioConfigSchema>

const profileFields = {
  name: z
    .string()
    .min(1, { error: "Name is required" })
    .max(120, { error: "Name must be at most 120 characters" }),
  /** Prefix for model-facing tool names (`namespace__tool`). Empty → derived from name. */
  namespace: z
    .string()
    .max(32, { error: "Tool namespace must be at most 32 characters" })
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, {
      error:
        "Tool namespace must start with a letter and use only letters, numbers, and underscores",
    }),
  enabled: z.boolean().default(true),
  protocolMode: z.enum(["auto", "modern"]).default("auto"),
}

export const mcpTransportSchema = z.enum(["streamable-http", "sse", "stdio"])
/** `auto` uses the v2 client's backwards-compatible negotiation. */
export const mcpProtocolModeSchema = z.enum(["auto", "modern"])

/**
 * Prefix used in tool ids so multiple MCP servers can expose the same tool
 * name (e.g. `files__read` vs `git__read`) without clashing in the model tool set.
 */
export function namespaceFromDisplayName(name: string): string {
  let slug = name
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
  if (!slug) slug = "mcp"
  if (!/^[A-Za-z]/.test(slug)) slug = `m_${slug}`
  return slug.slice(0, 32)
}

function fillDefaultNamespace(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw
  const row = raw as Record<string, unknown>
  const name = typeof row.name === "string" ? row.name : ""
  const namespace =
    typeof row.namespace === "string" ? row.namespace.trim() : ""
  return {
    ...row,
    namespace: namespace || namespaceFromDisplayName(name),
  }
}

const mcpProfileShapeSchema = z.discriminatedUnion("transport", [
  z.object({
    ...profileFields,
    transport: z.literal("streamable-http"),
    config: httpConfigSchema,
  }),
  z.object({
    ...profileFields,
    transport: z.literal("sse"),
    config: httpConfigSchema,
  }),
  z.object({
    ...profileFields,
    transport: z.literal("stdio"),
    config: stdioConfigSchema,
  }),
])

export const mcpProfileInputSchema = z.preprocess(
  fillDefaultNamespace,
  mcpProfileShapeSchema
)

export type McpProfileInput = z.infer<typeof mcpProfileShapeSchema>
export type McpTransport = z.infer<typeof mcpTransportSchema>
export type McpProtocolMode = z.infer<typeof mcpProtocolModeSchema>

const catalogToolSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  fingerprint: z.string(),
})

export const mcpCatalogSchema = z.object({
  serverName: z.string().optional(),
  serverVersion: z.string().optional(),
  instructions: z.string().optional(),
  tools: z.array(catalogToolSchema).default([]),
  prompts: z.array(z.unknown()).default([]),
  resources: z.array(z.unknown()).default([]),
  resourceTemplates: z.array(z.unknown()).default([]),
  era: z.enum(["modern", "legacy"]).optional(),
  refreshedAt: z.string().optional(),
})
export type McpCatalog = z.infer<typeof mcpCatalogSchema>

export type McpToolDiff = {
  added: string[]
  removed: string[]
  changed: string[]
}

export type McpProfile = {
  id: string
  user_id: string
  name: string
  namespace: string
  enabled: boolean
  transport: McpTransport
  protocolMode: McpProtocolMode
  config: McpProfileInput["config"]
  catalog: McpCatalog
  toolAllowlist: string[]
  created_at: string
  updated_at: string
}

export type McpProfileRow = {
  id: string
  user_id: string
  name: string
  namespace: string
  enabled: boolean
  transport: string
  protocol_mode: string
  config_json: string
  catalog_json: string
  tool_allowlist_json: string
  created_at: string
  updated_at: string
}

/**
 * Whether a stored value is safe to return to the client.
 * Template-only / template+short prefix strings are safe; bare secrets are not.
 */
export function canReturnKvValue(value: string): boolean {
  if (!value) return true
  const hasTemplate = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value)
  if (!hasTemplate) return false
  const withoutTemplates = value.replace(ENV_TEMPLATE_RE, "\0")
  for (const segment of withoutTemplates.split("\0")) {
    const compact = segment.replace(/[\s\-.,:/=_+@]/g, "")
    if (/[A-Za-z0-9+/=]{12,}/.test(compact)) return false
  }
  return true
}

export function redactKvEntries(
  entries: McpKvEntry[]
): Array<{ name: string; value?: string; hasStoredValue: boolean }> {
  return entries.map((entry) => {
    const value = entry.value ?? ""
    if (!value) return { name: entry.name, hasStoredValue: false }
    if (canReturnKvValue(value))
      return { name: entry.name, value, hasStoredValue: false }
    return { name: entry.name, hasStoredValue: true }
  })
}

function redactConfig(config: McpProfileInput["config"]) {
  return "url" in config
    ? { ...config, headers: redactKvEntries(config.headers) }
    : { ...config, env: redactKvEntries(config.env) }
}

/** Expand `${ENV}` tokens. Returns undefined if any referenced env is missing. */
export function resolveTemplateValue(
  value: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  let missing = false
  const resolved = value.replace(ENV_TEMPLATE_RE, (_match, name: string) => {
    const found = env[name]
    if (found == null) {
      missing = true
      return ""
    }
    return found
  })
  if (missing) return undefined
  return resolved
}

/** Resolve KV entries for HTTP headers or stdio env; omit unresolved templates. */
export function resolveKvEntries(
  entries: McpKvEntry[],
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of entries) {
    if (entry.value == null || entry.value === "") continue
    const resolved = resolveTemplateValue(entry.value, env)
    if (resolved == null) continue
    out[entry.name] = resolved
  }
  return out
}

export function mergeKvEntries(
  oldEntries: McpKvEntry[],
  nextEntries: McpKvEntry[]
): McpKvEntry[] {
  const oldByName = new Map(
    oldEntries.map((entry) => [entry.name.toLowerCase(), entry])
  )
  return nextEntries.map((entry) => {
    if (entry.value !== undefined && entry.value !== "") return entry
    const previous = oldByName.get(entry.name.toLowerCase())
    if (previous?.value) return { name: entry.name, value: previous.value }
    return {
      name: entry.name,
      ...(entry.value !== undefined ? { value: entry.value } : {}),
    }
  })
}

export function mergeStoredValues(
  oldConfig: McpProfileInput["config"],
  nextConfig: McpProfileInput["config"]
): McpProfileInput["config"] {
  if ("url" in oldConfig && "url" in nextConfig) {
    return {
      ...nextConfig,
      headers: mergeKvEntries(oldConfig.headers, nextConfig.headers),
    }
  }
  if (!("url" in oldConfig) && !("url" in nextConfig)) {
    return {
      ...nextConfig,
      env: mergeKvEntries(oldConfig.env, nextConfig.env),
    }
  }
  return nextConfig
}

/** Keep prior allowlist ∩ live tools; new tools stay off. */
export function defaultAllowlistSelection(
  previousAllowlist: string[],
  catalog: McpCatalog
): string[] {
  const live = new Set(catalog.tools.map((tool) => tool.name))
  return previousAllowlist.filter((name) => live.has(name))
}

export function toolFingerprint(tool: {
  name: string
  title?: string
  description?: string
  inputSchema: unknown
}) {
  return JSON.stringify([
    tool.name,
    tool.title ?? "",
    tool.description ?? "",
    tool.inputSchema,
  ])
}

export function diffCatalogTools(
  previous: McpCatalog,
  next: McpCatalog
): McpToolDiff {
  const prevMap = new Map(
    previous.tools.map((tool) => [tool.name, tool.fingerprint])
  )
  const nextMap = new Map(
    next.tools.map((tool) => [tool.name, tool.fingerprint])
  )
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const [name, fingerprint] of nextMap) {
    if (!prevMap.has(name)) added.push(name)
    else if (prevMap.get(name) !== fingerprint) changed.push(name)
  }
  for (const name of prevMap.keys()) {
    if (!nextMap.has(name)) removed.push(name)
  }
  return { added, removed, changed }
}

function metadataList(
  items: unknown[],
  pick: (item: Record<string, unknown>) => Record<string, string> | null
) {
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const picked = pick(item as Record<string, unknown>)
    return picked ? [picked] : []
  })
}

/**
 * Optional system prose from MCP initialize instructions only.
 * Resources/prompts are not ambient context — open them via chat attach/insert.
 */
export function buildMcpInstructionsText(
  profiles: Array<{ name: string; instructions?: string | null }>
): string {
  const blocks: string[] = []
  for (const profile of profiles) {
    const instructions = profile.instructions?.trim()
    if (!instructions) continue
    blocks.push(`MCP server “${profile.name}”:\n${instructions}`)
  }
  return blocks.join("\n\n")
}

export const MCP_RESOURCE_TEXT_MAX = MAX_ATTACHMENT_TEXT_CHARS

export function safeToolName(namespace: string, toolName: string) {
  const raw = `${namespace}__${toolName}`.replace(/[^A-Za-z0-9_-]/g, "_")
  if (raw.length <= 64) return raw
  let hash = 0
  for (const char of raw) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `${raw.slice(0, 55)}_${hash.toString(36).slice(0, 8)}`
}

export function profileFromRow(row: McpProfileRow): McpProfile {
  const transport = mcpTransportSchema
    .catch("streamable-http")
    .parse(row.transport)
  const rawConfig = parseJson(row.config_json, {})
  const config =
    transport === "stdio"
      ? stdioConfigSchema
          .catch({
            command: "",
            args: [],
            env: [],
            connectTimeoutMs: 10_000,
            callTimeoutMs: 60_000,
          })
          .parse(rawConfig)
      : httpConfigSchema
          .catch({
            url: "http://invalid.local",
            headers: [],
            followRedirects: false,
            connectTimeoutMs: 10_000,
            callTimeoutMs: 60_000,
          })
          .parse(rawConfig)
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    namespace: row.namespace,
    enabled: fromDbBool(row.enabled),
    transport,
    protocolMode: mcpProtocolModeSchema.catch("auto").parse(row.protocol_mode),
    config,
    catalog: mcpCatalogSchema
      .catch({ tools: [], prompts: [], resources: [], resourceTemplates: [] })
      .parse(parseJson(row.catalog_json, {})),
    toolAllowlist: parseJson<string[]>(row.tool_allowlist_json, []),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function runtimeMcpMode(): "stateful" | "stateless" {
  return process.env.MCP_RUNTIME_MODE === "stateless" ? "stateless" : "stateful"
}

export function profileSupported(profile: {
  transport: McpTransport
  protocolMode: McpProtocolMode
}) {
  if (runtimeMcpMode() !== "stateless") return true
  return (
    profile.transport === "streamable-http" && profile.protocolMode === "modern"
  )
}

export async function listMcpProfiles(userId: string) {
  const rows = await db
    .selectFrom("mcp_server_profiles")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("name")
    .execute()
  return rows.map(profileFromRow).map((profile) => ({
    ...profile,
    config: redactConfig(profile.config),
    runtimeSupported: profileSupported(profile),
  }))
}

export async function getEnabledMcpProfiles(userId: string) {
  const rows = await db
    .selectFrom("mcp_server_profiles")
    .selectAll()
    .where("user_id", "=", userId)
    .where("enabled", "=", toDbBool(true))
    .execute()
  return rows.map(profileFromRow)
}

/** Load a single profile for the owner (or null if missing/foreign). */
export async function getMcpProfile(
  userId: string,
  profileId: string
): Promise<McpProfile | null> {
  const row = await db
    .selectFrom("mcp_server_profiles")
    .selectAll()
    .where("id", "=", profileId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  return row ? profileFromRow(row) : null
}

/** Portable profile data: keep templates only; drop opaque secrets. */
export function mcpProfileForBackup(profile: McpProfile) {
  const stripEntries = (entries: McpKvEntry[]) =>
    entries.map((entry) => {
      const value = entry.value ?? ""
      if (value && canReturnKvValue(value)) return { name: entry.name, value }
      return { name: entry.name }
    })
  const config =
    "url" in profile.config
      ? { ...profile.config, headers: stripEntries(profile.config.headers) }
      : { ...profile.config, env: stripEntries(profile.config.env) }
  return {
    id: profile.id,
    user_id: profile.user_id,
    name: profile.name,
    namespace: profile.namespace,
    enabled: profile.enabled,
    transport: profile.transport,
    protocol_mode: profile.protocolMode,
    config_json: JSON.stringify(config),
    catalog_json: JSON.stringify(profile.catalog),
    tool_allowlist_json: JSON.stringify(profile.toolAllowlist),
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  }
}

function validateRuntime(input: McpProfileInput) {
  if (
    runtimeMcpMode() === "stateless" &&
    (input.transport !== "streamable-http" || input.protocolMode !== "modern")
  ) {
    throw new Error(
      "Stateless mode only permits modern Streamable HTTP MCP profiles."
    )
  }
  if (input.transport === "sse" && input.protocolMode === "modern")
    throw new Error("SSE is a legacy MCP transport.")
}

function configForStorage(config: McpProfileInput["config"]) {
  if ("url" in config) {
    return {
      ...config,
      headers: config.headers.map(({ name, value }) => ({
        name,
        ...(value != null ? { value } : {}),
      })),
    }
  }
  return {
    ...config,
    env: config.env.map(({ name, value }) => ({
      name,
      ...(value != null ? { value } : {}),
    })),
  }
}

export async function createMcpProfile(userId: string, raw: McpProfileInput) {
  const input = mcpProfileInputSchema.parse(raw)
  validateRuntime(input)
  const timestamp = now()
  const row = {
    id: id(),
    user_id: userId,
    name: input.name,
    namespace: input.namespace,
    enabled: toDbBool(input.enabled),
    transport: input.transport,
    protocol_mode: input.protocolMode,
    config_json: JSON.stringify(configForStorage(input.config)),
    catalog_json: JSON.stringify({}),
    tool_allowlist_json: "[]",
    created_at: timestamp,
    updated_at: timestamp,
  }
  await db.insertInto("mcp_server_profiles").values(row).execute()
  return { id: row.id }
}

export async function updateMcpProfile(
  userId: string,
  profileId: string,
  raw: McpProfileInput
) {
  const input = mcpProfileInputSchema.parse(raw)
  validateRuntime(input)
  const existing = await db
    .selectFrom("mcp_server_profiles")
    .selectAll()
    .where("id", "=", profileId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!existing) throw new Error("MCP profile not found")
  const old = profileFromRow(existing)
  const config = mergeStoredValues(old.config, input.config)
  await db
    .updateTable("mcp_server_profiles")
    .set({
      name: input.name,
      namespace: input.namespace,
      enabled: toDbBool(input.enabled),
      transport: input.transport,
      protocol_mode: input.protocolMode,
      config_json: JSON.stringify(configForStorage(config)),
      updated_at: now(),
    })
    .where("id", "=", profileId)
    .execute()
  connectionManager.invalidate(profileId)
}

export async function deleteMcpProfile(userId: string, profileId: string) {
  await db
    .deleteFrom("mcp_server_profiles")
    .where("id", "=", profileId)
    .where("user_id", "=", userId)
    .execute()
  connectionManager.invalidate(profileId)
}

async function listCatalogFromClient(client: Client): Promise<McpCatalog> {
  const [tools, prompts, resources, templates] = await Promise.all([
    client.listTools(),
    client.listPrompts(),
    client.listResources(),
    client.listResourceTemplates(),
  ])
  return {
    serverName: client.getServerVersion()?.name,
    serverVersion: client.getServerVersion()?.version,
    instructions: client.getInstructions(),
    tools: tools.tools.map((tool) => ({
      name: tool.name,
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema as Record<string, unknown>,
      ...(tool.outputSchema
        ? { outputSchema: tool.outputSchema as Record<string, unknown> }
        : {}),
      fingerprint: toolFingerprint(tool),
    })),
    prompts: prompts.prompts,
    resources: resources.resources,
    resourceTemplates: templates.resourceTemplates,
    era: client.getProtocolEra() ?? undefined,
    refreshedAt: now(),
  }
}

export async function refreshMcpCatalog(userId: string, profileId: string) {
  const row = await db
    .selectFrom("mcp_server_profiles")
    .selectAll()
    .where("id", "=", profileId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("MCP profile not found")
  const profile = profileFromRow(row)
  if (!profileSupported(profile))
    throw new Error(
      "This profile is not available in the current MCP runtime mode."
    )
  const client = await createClient(profile)
  try {
    const catalog = await listCatalogFromClient(client)
    const previous = profile.catalog
    return {
      catalog,
      previous,
      diff: diffCatalogTools(previous, catalog),
      suggestedAllowlist: defaultAllowlistSelection(
        profile.toolAllowlist,
        catalog
      ),
    }
  } finally {
    await client.close()
  }
}

/**
 * Server-authoritative approve: re-list the live server, then persist
 * catalog + allowlist. Clients must not supply a trusted catalog.
 */
export async function approveMcpCatalog(
  userId: string,
  profileId: string,
  toolAllowlist: string[]
) {
  const row = await db
    .selectFrom("mcp_server_profiles")
    .selectAll()
    .where("id", "=", profileId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!row) throw new Error("MCP profile not found")
  const profile = profileFromRow(row)
  if (!profileSupported(profile))
    throw new Error(
      "This profile is not available in the current MCP runtime mode."
    )
  const client = await createClient(profile)
  try {
    const catalog = await listCatalogFromClient(client)
    const available = new Set(catalog.tools.map((tool) => tool.name))
    if (toolAllowlist.some((name) => !available.has(name)))
      throw new Error("Tool allowlist contains an unknown tool")
    await db
      .updateTable("mcp_server_profiles")
      .set({
        catalog_json: JSON.stringify(catalog),
        tool_allowlist_json: JSON.stringify(toolAllowlist),
        updated_at: now(),
      })
      .where("id", "=", profileId)
      .execute()
    connectionManager.invalidate(profileId)
    return { catalog, toolAllowlist }
  } finally {
    await client.close()
  }
}

/**
 * Stdio is intentional for owner/admin self-host: the configured command runs
 * as a full subprocess of the next process with inherited env plus overrides.
 */
async function createClient(profile: McpProfile) {
  const mode =
    profile.protocolMode === "modern"
      ? { mode: { pin: "2026-07-28" } as const }
      : { mode: "auto" as const }
  const client = new Client(
    { name: "nibchat", version: "1.0.0" },
    { versionNegotiation: mode }
  )
  if (profile.transport === "stdio") {
    const { StdioClientTransport } =
      await import("@modelcontextprotocol/client/stdio")
    const config = stdioConfigSchema.parse(profile.config)
    await client.connect(
      new StdioClientTransport({
        command: config.command,
        args: config.args,
        ...(config.cwd ? { cwd: config.cwd } : {}),
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] => entry[1] != null
            )
          ),
          ...resolveKvEntries(config.env),
        },
      }),
      { timeout: config.connectTimeoutMs }
    )
    return client
  }
  const config = httpConfigSchema.parse(profile.config)
  const requestInit: RequestInit = {
    headers: resolveKvEntries(config.headers),
    redirect: config.followRedirects ? "follow" : "error",
  }
  const transport =
    profile.transport === "sse"
      ? new SSEClientTransport(new URL(config.url), { requestInit })
      : new StreamableHTTPClientTransport(new URL(config.url), { requestInit })
  await client.connect(transport, { timeout: config.connectTimeoutMs })
  return client
}

type Managed = {
  /** Process-local generation when this map entry was created. */
  generation: number
  client?: Client
  opening?: Promise<Client>
  leases: number
  retiring: boolean
}

/**
 * Process-local pool. No durable "revision" column — mutators call
 * `invalidate(profileId)`, which bumps an in-memory generation and retires
 * the live client so the next acquire reconnects with current DB config.
 */
class McpConnectionManager {
  private entries = new Map<string, Managed>()
  /** Current generation per profileId (starts at 0; invalidate increments). */
  private generations = new Map<string, number>()

  private genOf(profileId: string) {
    return this.generations.get(profileId) ?? 0
  }

  async acquire(
    profile: McpProfile
  ): Promise<{ client: Client; release: () => Promise<void> }> {
    if (runtimeMcpMode() === "stateless") {
      const client = await createClient(profile)
      return { client, release: () => client.close() }
    }
    const generation = this.genOf(profile.id)
    let entry = this.entries.get(profile.id)
    if (!entry || entry.generation !== generation) {
      if (entry) this.retire(entry)
      entry = { generation, leases: 0, retiring: false }
      this.entries.set(profile.id, entry)
    }
    entry.leases += 1
    entry.opening ??= createClient(profile)
      .then((client) => {
        entry!.client = client
        entry!.opening = undefined
        return client
      })
      .catch((error) => {
        entry!.opening = undefined
        if (entry!.leases <= 1) this.entries.delete(profile.id)
        throw error
      })
    try {
      const client = entry.client ?? (await entry.opening)
      return { client, release: async () => this.release(profile.id, entry!) }
    } catch (error) {
      await this.release(profile.id, entry)
      if (this.entries.get(profile.id) === entry && !entry.client)
        this.entries.delete(profile.id)
      throw error
    }
  }

  invalidate(profileId: string) {
    this.generations.set(profileId, this.genOf(profileId) + 1)
    const entry = this.entries.get(profileId)
    this.entries.delete(profileId)
    if (entry) this.retire(entry)
  }

  private retire(entry: Managed) {
    entry.retiring = true
    if (entry.leases === 0 && entry.client) void entry.client.close()
  }

  private async release(profileId: string, entry: Managed) {
    entry.leases = Math.max(0, entry.leases - 1)
    if (entry.retiring && entry.leases === 0 && entry.client) {
      await entry.client.close()
    }
    if (
      entry.retiring &&
      entry.leases === 0 &&
      this.entries.get(profileId) === entry
    ) {
      this.entries.delete(profileId)
    }
  }
}

const globalForMcp = globalThis as unknown as {
  nibchatMcpManager?: McpConnectionManager
}
export const connectionManager =
  globalForMcp.nibchatMcpManager ?? new McpConnectionManager()
globalForMcp.nibchatMcpManager = connectionManager

export type PrepareMcpToolsOptions = {
  /** When true (MCP server-instructions module enabled), build system text. */
  includeInstructionsText?: boolean
  /** Built-in tool names that MCP must not overwrite. */
  reservedToolNames?: Iterable<string>
}

/**
 * Always loads approved tools for enabled/runtime-supported profiles.
 * Instructions text is independent of tool registration (stack module).
 * Tool execute reloads the profile from the DB so pool config stays current.
 */
export async function prepareMcpTools(
  userId: string,
  options: PrepareMcpToolsOptions = {}
) {
  const includeInstructionsText = options.includeInstructionsText === true
  const reserved = new Set(options.reservedToolNames ?? [])
  const profiles = await getEnabledMcpProfiles(userId)
  const supported = profiles.filter(profileSupported)
  const warnings = profiles
    .filter((profile) => !profileSupported(profile))
    .map(
      (profile) => `${profile.name} is unavailable in ${runtimeMcpMode()} mode.`
    )
  const tools: ToolSet = {}

  for (const profile of supported) {
    const allowed = profile.catalog.tools.filter((tool) =>
      profile.toolAllowlist.includes(tool.name)
    )
    for (const definition of allowed) {
      const name = safeToolName(profile.namespace, definition.name)
      if (reserved.has(name)) {
        warnings.push(
          `MCP tool ${profile.name}/${definition.name} conflicts with a built-in tool name (${name}).`
        )
        continue
      }
      if (tools[name]) {
        warnings.push(
          `Tool name collision for ${profile.name}/${definition.name}.`
        )
        continue
      }
      const profileId = profile.id
      const toolName = definition.name
      tools[name] = dynamicTool({
        description: definition.description ?? `MCP tool ${definition.name}`,
        inputSchema: jsonSchema(definition.inputSchema as never),
        metadata: {
          mcp: {
            profileId,
            profileName: profile.name,
            toolName,
          },
        },
        execute: async (input, options) => {
          const live = await getMcpProfile(userId, profileId)
          if (!live || !live.enabled)
            throw new Error(`MCP server is no longer available.`)
          if (!profileSupported(live))
            throw new Error(
              `MCP server “${live.name}” is unavailable in ${runtimeMcpMode()} mode.`
            )
          if (!live.toolAllowlist.includes(toolName))
            throw new Error(
              `Tool “${toolName}” is no longer approved for “${live.name}”.`
            )
          const lease = await connectionManager.acquire(live)
          const timeout =
            "callTimeoutMs" in live.config ? live.config.callTimeoutMs : 60_000
          try {
            return (await lease.client.callTool(
              {
                name: toolName,
                arguments: input as Record<string, unknown>,
              },
              { signal: options.abortSignal, timeout }
            )) as CallToolResult
          } catch (error) {
            connectionManager.invalidate(profileId)
            throw error
          } finally {
            await lease.release()
          }
        },
      })
    }
  }

  const instructionsText = includeInstructionsText
    ? buildMcpInstructionsText(
        supported.map((profile) => ({
          name: profile.name,
          instructions: profile.catalog.instructions,
        }))
      )
    : ""

  return {
    tools,
    instructionsText,
    warnings,
  }
}

export type McpSurfaceResource = {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export type McpSurfacePrompt = {
  name: string
  title?: string
  description?: string
}

export type McpApprovedSurface = {
  profileId: string
  profileName: string
  namespace: string
  resources: McpSurfaceResource[]
  prompts: McpSurfacePrompt[]
}

/** Approved catalog resources/prompts for chat pickers (no ambient system dump). */
export async function listApprovedMcpSurfaces(
  userId: string
): Promise<McpApprovedSurface[]> {
  const profiles = (await getEnabledMcpProfiles(userId)).filter(
    profileSupported
  )
  return profiles.map((profile) => {
    const resources = metadataList(profile.catalog.resources, (item) => {
      const uri = typeof item.uri === "string" ? item.uri : null
      if (!uri) return null
      const name =
        typeof item.name === "string"
          ? item.name
          : typeof item.title === "string"
            ? item.title
            : uri
      const description =
        typeof item.description === "string" ? item.description : undefined
      const mimeType =
        typeof item.mimeType === "string" ? item.mimeType : undefined
      return {
        uri,
        name,
        ...(description ? { description } : {}),
        ...(mimeType ? { mimeType } : {}),
      }
    }) as McpSurfaceResource[]
    const prompts = metadataList(profile.catalog.prompts, (item) => {
      const name = typeof item.name === "string" ? item.name : null
      if (!name) return null
      const title = typeof item.title === "string" ? item.title : undefined
      const description =
        typeof item.description === "string" ? item.description : undefined
      return {
        name,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
      }
    }) as McpSurfacePrompt[]
    return {
      profileId: profile.id,
      profileName: profile.name,
      namespace: profile.namespace,
      resources,
      prompts,
    }
  })
}

type McpResourceContent = {
  type?: string
  text?: string
  uri?: string
  mimeType?: string
  blob?: string
}

export function textFromResourceContents(contents: McpResourceContent[]) {
  const chunks: string[] = []
  for (const item of contents) {
    if (item.type === "text" && typeof item.text === "string") {
      chunks.push(item.text)
      continue
    }
    if (typeof item.text === "string" && item.text) {
      chunks.push(item.text)
      continue
    }
  }
  const text = chunks.join("\n\n").trim()
  if (!text) return null
  if (text.length <= MCP_RESOURCE_TEXT_MAX)
    return { kind: "text" as const, text }
  return {
    kind: "text" as const,
    text: text.slice(0, MCP_RESOURCE_TEXT_MAX),
    truncated: { originalCharacters: text.length },
  }
}

function approvedMcpResource(
  profile: McpProfile,
  uri: string
): { name: string } | undefined {
  const resources = metadataList(profile.catalog.resources, (item) => {
    if (item.uri !== uri) return null
    const name =
      typeof item.name === "string"
        ? item.name
        : typeof item.title === "string"
          ? item.title
          : uri
    return { name }
  })
  const resource = resources[0]
  return resource && typeof resource.name === "string"
    ? { name: resource.name }
    : undefined
}

export async function resolveMcpResourceAttachment(
  userId: string,
  reference: AttachmentReference
): Promise<AttachmentPart> {
  if (reference.kind !== "mcp-resource")
    throw new Error("Unsupported attachment source.")
  const profile = await getMcpProfile(userId, reference.profileId)
  if (!profile || !profile.enabled) throw new Error("MCP profile not found")
  if (!profileSupported(profile))
    throw new Error(
      "This profile is not available in the current MCP runtime mode."
    )
  const listed = approvedMcpResource(profile, reference.uri)
  if (!listed) throw new Error("MCP resource is not in the approved catalog.")
  const lease = await connectionManager.acquire(profile)
  try {
    let result: Awaited<ReturnType<typeof lease.client.readResource>>
    try {
      result = await lease.client.readResource({ uri: reference.uri })
    } catch (error) {
      connectionManager.invalidate(reference.profileId)
      throw error
    }
    const contents = (result.contents ?? []) as McpResourceContent[]
    const content = textFromResourceContents(contents)
    if (!content) throw new Error("Resource has no readable text content.")
    return {
      type: "attachment" as const,
      id: crypto.randomUUID(),
      name: listed.name,
      content,
      source: {
        kind: "mcp-resource" as const,
        profileId: profile.id,
        profileName: profile.name,
        uri: reference.uri,
      },
    }
  } finally {
    await lease.release()
  }
}

export async function getMcpPrompt(
  userId: string,
  profileId: string,
  name: string,
  args: Record<string, string> = {}
) {
  const profile = await getMcpProfile(userId, profileId)
  if (!profile || !profile.enabled) throw new Error("MCP profile not found")
  if (!profileSupported(profile))
    throw new Error(
      "This profile is not available in the current MCP runtime mode."
    )
  const lease = await connectionManager.acquire(profile)
  try {
    const result = await lease.client.getPrompt({
      name,
      arguments: args,
    })
    const messages = result.messages ?? []
    const chunks = messages.map((message) => {
      const role = message.role ?? "user"
      const content = message.content
      let body = ""
      if (typeof content === "string") body = content
      else if (Array.isArray(content)) {
        body = content
          .map((part) => {
            if (typeof part === "string") return part
            if (part && typeof part === "object" && "text" in part)
              return String((part as { text: unknown }).text ?? "")
            if (part && typeof part === "object" && "type" in part) {
              const p = part as { type?: string; text?: string }
              if (p.type === "text" && p.text) return p.text
            }
            return ""
          })
          .filter(Boolean)
          .join("\n")
      } else if (content && typeof content === "object" && "text" in content) {
        body = String((content as { text: unknown }).text ?? "")
      }
      return body.trim() ? `[${role}]\n${body.trim()}` : ""
    })
    const text = chunks.filter(Boolean).join("\n\n").trim()
    if (!text) throw new Error("Prompt returned no text content.")
    return { text, description: result.description }
  } catch (error) {
    connectionManager.invalidate(profileId)
    throw error
  } finally {
    await lease.release()
  }
}
