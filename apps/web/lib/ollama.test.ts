import { describe, expect, it } from "vitest"
import {
  OLLAMA_CLOUD_BASE_URL,
  OLLAMA_DEFAULT_BASE_URL,
  applyOllamaHostMode,
  isOllamaCloudUrl,
  isOllamaPresetUrl,
  ollamaApiUrl,
  ollamaBaseUrl,
  ollamaHostMode,
} from "@/lib/ollama"

describe("Ollama URLs", () => {
  it("defaults to the local daemon and derives both API families", () => {
    expect(ollamaBaseUrl()).toBe(OLLAMA_DEFAULT_BASE_URL)
    expect(ollamaApiUrl(undefined, "api/tags")).toBe(
      "http://127.0.0.1:11434/api/tags"
    )
    expect(ollamaApiUrl(undefined, "v1")).toBe("http://127.0.0.1:11434/v1")
  })

  it("accepts common pasted endpoint suffixes and preserves proxy paths", () => {
    expect(ollamaBaseUrl("https://ollama.example/proxy/v1/")).toBe(
      "https://ollama.example/proxy"
    )
    expect(ollamaApiUrl("https://ollama.example/proxy/api", "api/tags")).toBe(
      "https://ollama.example/proxy/api/tags"
    )
  })

  it("canonicalizes Ollama Cloud aliases before making requests", () => {
    expect(ollamaBaseUrl("https://www.ollama.com/v1")).toBe(
      OLLAMA_CLOUD_BASE_URL
    )
    expect(ollamaBaseUrl("http://ollama.com/api")).toBe(
      OLLAMA_CLOUD_BASE_URL
    )
    expect(ollamaApiUrl("https://www.ollama.com", "v1")).toBe(
      "https://ollama.com/v1"
    )
  })

  it("rejects non-HTTP hosts", () => {
    expect(() => ollamaBaseUrl("file:///models")).toThrow(/HTTP or HTTPS/)
    expect(() => ollamaBaseUrl("not a url")).toThrow(/valid HTTP\(S\) URL/)
  })

  it("treats ollama.com as Cloud and other hosts as Local", () => {
    expect(isOllamaCloudUrl("https://ollama.com")).toBe(true)
    expect(isOllamaCloudUrl("https://www.ollama.com/v1")).toBe(true)
    expect(isOllamaCloudUrl("")).toBe(false)
    expect(isOllamaCloudUrl(OLLAMA_DEFAULT_BASE_URL)).toBe(false)
    expect(ollamaHostMode("https://ollama.com")).toBe("cloud")
    expect(ollamaHostMode("")).toBe("local")
  })

  it("writes Cloud/Local presets without clobbering a custom local URL", () => {
    expect(applyOllamaHostMode("", "cloud")).toBe(OLLAMA_CLOUD_BASE_URL)
    expect(applyOllamaHostMode(OLLAMA_DEFAULT_BASE_URL, "cloud")).toBe(
      OLLAMA_CLOUD_BASE_URL
    )
    expect(applyOllamaHostMode("https://ollama.com/v1", "cloud")).toBe(
      OLLAMA_CLOUD_BASE_URL
    )
    expect(applyOllamaHostMode(OLLAMA_CLOUD_BASE_URL, "local")).toBe("")
    expect(applyOllamaHostMode("http://gpu.home:11434", "local")).toBe(
      "http://gpu.home:11434"
    )
    expect(isOllamaPresetUrl(OLLAMA_DEFAULT_BASE_URL)).toBe(true)
    expect(isOllamaPresetUrl(OLLAMA_CLOUD_BASE_URL)).toBe(true)
    expect(isOllamaPresetUrl("http://host.docker.internal:11434")).toBe(false)
  })
})
