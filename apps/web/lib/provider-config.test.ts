import { describe, expect, it } from "vitest"
import { defaultProviderHeaders } from "@/lib/provider-config"
import { resolveConfigEntries } from "@/lib/config-entries"

describe("provider connection configuration", () => {
  it("resolves provider headers and omits missing templates", () => {
    expect(
      resolveConfigEntries(
        [
          { name: "Authorization", value: "Bearer ${TOKEN}" },
          { name: "X-Omit", value: "${MISSING}" },
        ],
        { TOKEN: "abc" }
      )
    ).toEqual({ Authorization: "Bearer abc" })
  })

  it("seeds native provider authentication templates only where appropriate", () => {
    expect(defaultProviderHeaders("openai")).toEqual([
      { name: "Authorization", value: "Bearer ${OPENAI_API_KEY}" },
    ])
    expect(defaultProviderHeaders("anthropic")).toEqual([
      { name: "x-api-key", value: "${ANTHROPIC_API_KEY}" },
    ])
    expect(defaultProviderHeaders("openai-compatible")).toEqual([])
    expect(defaultProviderHeaders("ollama", { ollamaCloud: true })).toEqual([
      { name: "Authorization", value: "Bearer ${OLLAMA_API_KEY}" },
    ])
  })
})
