import { describe, expect, it, vi } from "vitest"
import { discoverOllamaModels } from "@/lib/provider-catalog"

describe("Ollama catalog discovery", () => {
  it("uses native tags and omits auth for a local daemon", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            { model: "gemma4:latest", name: "gemma4:latest" },
            { name: "fallback" },
            { model: "gemma4:latest" },
          ],
        })
      )
    )
    await expect(
      discoverOllamaModels(
        { name: "Ollama", base_url: null },
        undefined,
        fetchFn
      )
    ).resolves.toEqual([
      { id: "gemma4:latest", name: "gemma4:latest" },
      { id: "fallback", name: "fallback" },
    ])
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/tags",
      expect.objectContaining({ headers: {} })
    )
  })

  it("adds bearer auth and reports provider errors", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid API key" }), {
          status: 401,
        })
      )
    await expect(
      discoverOllamaModels(
        { name: "Ollama Cloud", base_url: "https://ollama.com" },
        "secret",
        fetchFn
      )
    ).rejects.toThrow(/HTTP 401.*invalid API key/)
    expect(fetchFn).toHaveBeenCalledWith(
      "https://ollama.com/api/tags",
      expect.objectContaining({
        headers: { authorization: "Bearer secret" },
      })
    )
  })

  it("does not forward a retained Cloud key to a local host", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ models: [] })))
    await discoverOllamaModels(
      { name: "Ollama", base_url: "http://gpu.home:11434" },
      "cloud-secret",
      fetchFn
    )
    expect(fetchFn).toHaveBeenCalledWith(
      "http://gpu.home:11434/api/tags",
      expect.objectContaining({ headers: {} })
    )
  })

  it("rejects malformed successful payloads", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] })))
    await expect(
      discoverOllamaModels(
        { name: "Ollama", base_url: null },
        undefined,
        fetchFn
      )
    ).rejects.toThrow(/invalid model catalog/)
  })
})
