import { beforeAll, describe, expect, it } from "vitest"
import {
  buildMcpInstructionsText,
  canReturnKvValue,
  createMcpProfile,
  defaultAllowlistSelection,
  diffCatalogTools,
  getEnabledMcpProfiles,
  getMcpProfile,
  mergeKvEntries,
  mergeStoredValues,
  mcpProfileInputSchema,
  namespaceFromDisplayName,
  normalizeKvEntries,
  resolveKvEntries,
  resolveTemplateValue,
  safeToolName,
  textFromResourceContents,
  type McpCatalog,
} from "@/lib/mcp"
import { db, migrate } from "@/lib/db"

const emptyCatalog = (): McpCatalog => ({
  tools: [],
  prompts: [],
  resources: [],
  resourceTemplates: [],
})

describe("mcpProfileInputSchema", () => {
  it("accepts streamable-http with http config", () => {
    const parsed = mcpProfileInputSchema.parse({
      name: "Remote",
      namespace: "remote",
      transport: "streamable-http",
      protocolMode: "modern",
      config: {
        url: "https://mcp.example.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer ${TOKEN}" }],
      },
    })
    expect(parsed.transport).toBe("streamable-http")
    expect("url" in parsed.config).toBe(true)
  })

  it("accepts stdio with stdio config", () => {
    const parsed = mcpProfileInputSchema.parse({
      name: "FS",
      namespace: "files",
      transport: "stdio",
      config: {
        command: "npx",
        args: ["-y", "server"],
        env: [{ name: "HOME", value: "${HOME}" }],
      },
    })
    expect(parsed.transport).toBe("stdio")
    expect("command" in parsed.config).toBe(true)
  })

  it("derives namespace from display name when blank", () => {
    const parsed = mcpProfileInputSchema.parse({
      name: "Filesystem Tools",
      namespace: "",
      transport: "streamable-http",
      config: { url: "https://mcp.example.com/mcp", headers: [] },
    })
    expect(parsed.namespace).toBe("Filesystem_Tools")
  })

  it("keeps an explicit valid namespace", () => {
    const parsed = mcpProfileInputSchema.parse({
      name: "Filesystem Tools",
      namespace: "files",
      transport: "streamable-http",
      config: { url: "https://mcp.example.com/mcp", headers: [] },
    })
    expect(parsed.namespace).toBe("files")
  })

  it("rejects streamable-http with stdio-shaped config", () => {
    const result = mcpProfileInputSchema.safeParse({
      name: "Bad",
      namespace: "bad",
      transport: "streamable-http",
      config: { command: "npx", args: [] },
    })
    expect(result.success).toBe(false)
  })
})

describe("namespaceFromDisplayName", () => {
  it("slugifies display names", () => {
    expect(namespaceFromDisplayName("Filesystem Tools")).toBe(
      "Filesystem_Tools"
    )
    expect(namespaceFromDisplayName("123-git")).toBe("m_123_git")
    expect(namespaceFromDisplayName("  ")).toBe("mcp")
  })
})

describe("env templates", () => {
  it("keeps name and value and drops unknown fields", () => {
    expect(
      normalizeKvEntries([
        { name: "A", value: "${FOO}", extra: true },
        { name: "B", value: "literal" },
        { name: "" },
      ])
    ).toEqual([
      { name: "A", value: "${FOO}" },
      { name: "B", value: "literal" },
    ])
  })

  it("resolves template values", () => {
    expect(resolveTemplateValue("Bearer ${TOKEN}", { TOKEN: "secret" })).toBe(
      "Bearer secret"
    )
    expect(
      resolveTemplateValue("Bearer ${MISSING}", { OTHER: "x" })
    ).toBeUndefined()
  })

  it("resolveKvEntries omits missing templates", () => {
    expect(
      resolveKvEntries(
        [
          { name: "Authorization", value: "Bearer ${TOKEN}" },
          { name: "X-Empty", value: "${NOPE}" },
        ],
        { TOKEN: "abc" }
      )
    ).toEqual({ Authorization: "Bearer abc" })
  })
})

describe("redaction", () => {
  it("allows template-only and short-prefix values", () => {
    expect(canReturnKvValue("Bearer ${TOKEN}")).toBe(true)
    expect(canReturnKvValue("${TOKEN}")).toBe(true)
  })

  it("hides bare secrets", () => {
    expect(canReturnKvValue("sk-live-supersecrettoken")).toBe(false)
    expect(canReturnKvValue("plain")).toBe(false)
  })
})

describe("merge", () => {
  it("keeps previous secret when next value is blank", () => {
    expect(
      mergeKvEntries(
        [{ name: "Authorization", value: "secret-token" }],
        [{ name: "Authorization", value: "" }]
      )
    ).toEqual([{ name: "Authorization", value: "secret-token" }])
  })

  it("merges http configs by headers", () => {
    const merged = mergeStoredValues(
      {
        url: "https://a.example",
        headers: [{ name: "A", value: "keep-me" }],
        followRedirects: false,
        connectTimeoutMs: 10_000,
        callTimeoutMs: 60_000,
      },
      {
        url: "https://b.example",
        headers: [{ name: "A" }, { name: "B", value: "new" }],
        followRedirects: true,
        connectTimeoutMs: 5_000,
        callTimeoutMs: 30_000,
      }
    )
    expect("url" in merged && merged.url).toBe("https://b.example")
    if ("url" in merged) {
      expect(merged.headers).toEqual([
        { name: "A", value: "keep-me" },
        { name: "B", value: "new" },
      ])
    }
  })
})

describe("catalog diffs and allowlist", () => {
  it("classifies added, removed, and changed tools", () => {
    const previous: McpCatalog = {
      ...emptyCatalog(),
      tools: [
        {
          name: "read",
          inputSchema: { type: "object" },
          fingerprint: toolFingerprint("read", { type: "object" }),
        },
        {
          name: "gone",
          inputSchema: {},
          fingerprint: toolFingerprint("gone", {}),
        },
      ],
    }
    const next: McpCatalog = {
      ...emptyCatalog(),
      tools: [
        {
          name: "read",
          inputSchema: { type: "object", properties: { path: {} } },
          fingerprint: toolFingerprint("read", {
            type: "object",
            properties: { path: {} },
          }),
        },
        {
          name: "write",
          inputSchema: {},
          fingerprint: toolFingerprint("write", {}),
        },
      ],
    }
    expect(diffCatalogTools(previous, next)).toEqual({
      added: ["write"],
      removed: ["gone"],
      changed: ["read"],
    })
  })

  it("default allowlist keeps intersection only", () => {
    const catalog: McpCatalog = {
      ...emptyCatalog(),
      tools: [
        {
          name: "a",
          inputSchema: {},
          fingerprint: "[]",
        },
        {
          name: "b",
          inputSchema: {},
          fingerprint: "[]",
        },
      ],
    }
    expect(defaultAllowlistSelection(["a", "z"], catalog)).toEqual(["a"])
  })
})

describe("safeToolName", () => {
  it("namespaces tools", () => {
    expect(safeToolName("files", "read")).toBe("files__read")
  })

  it("hashes long names", () => {
    const long = "x".repeat(80)
    const name = safeToolName("ns", long)
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name.startsWith("ns__")).toBe(true)
  })
})

describe("buildMcpInstructionsText", () => {
  it("includes only server instructions as prose", () => {
    const text = buildMcpInstructionsText([
      { name: "files", instructions: "Use carefully" },
      { name: "empty", instructions: "  " },
      { name: "tools-only" },
    ])
    expect(text).toContain("MCP server “files”")
    expect(text).toContain("Use carefully")
    expect(text).not.toContain("empty")
    expect(text).not.toContain("inputSchema")
    expect(text).not.toContain("non-tool context")
  })

  it("returns empty when no instructions", () => {
    expect(
      buildMcpInstructionsText([{ name: "tools-only", instructions: null }])
    ).toBe("")
  })
})

describe("textFromResourceContents", () => {
  it("keeps text and silently omits binary content", () => {
    expect(
      textFromResourceContents([
        { type: "text", text: "First" },
        { type: "blob", blob: "AAE=" },
        { text: "Second" },
      ])
    ).toEqual({ kind: "text", text: "First\n\nSecond" })
  })

  it("rejects a resource with no readable text", () => {
    expect(
      textFromResourceContents([{ type: "blob", blob: "AAE=" }])
    ).toBeNull()
  })
})

describe("instance-shared MCP runtime", () => {
  const ownerId = "mcp-owner"
  const guestId = "mcp-guest"

  beforeAll(async () => {
    await migrate()
    const stamp = new Date().toISOString()
    for (const user of [
      { id: ownerId, email: "mcp-owner@test.local", name: "MCP Owner" },
      { id: guestId, email: "mcp-guest@test.local", name: "MCP Guest" },
    ]) {
      const existing = await db
        .selectFrom("user")
        .select("id")
        .where("id", "=", user.id)
        .executeTakeFirst()
      if (existing) continue
      await db
        .insertInto("user")
        .values({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: 1 as unknown as boolean,
          image: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute()
    }
    await db
      .updateTable("instance")
      .set({ owner_user_id: ownerId })
      .where("id", "=", 1)
      .execute()
  })

  it("lets a non-owner load enabled instance profiles", async () => {
    const enabled = await createMcpProfile(ownerId, {
      name: "Shared tools",
      namespace: `shared_${Date.now()}`,
      transport: "streamable-http",
      config: { url: "https://mcp.example.com/mcp", headers: [] },
    })
    await createMcpProfile(ownerId, {
      name: "Disabled tools",
      namespace: `off_${Date.now()}`,
      enabled: false,
      transport: "streamable-http",
      config: { url: "https://mcp.example.com/other", headers: [] },
    })
    const profiles = await getEnabledMcpProfiles()
    expect(profiles.some((profile) => profile.id === enabled.id)).toBe(true)
    expect(profiles.every((profile) => profile.enabled)).toBe(true)
    const loaded = await getMcpProfile(enabled.id)
    expect(loaded?.id).toBe(enabled.id)
    expect(loaded?.name).toBe("Shared tools")
  })
})

function toolFingerprint(name: string, inputSchema: unknown) {
  return JSON.stringify([name, "", "", inputSchema])
}
