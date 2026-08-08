import { describe, expect, it } from "vitest"
import { APICallError, LoadAPIKeyError } from "ai"
import { formatProviderError } from "@/lib/provider-errors"

describe("formatProviderError", () => {
  it("returns Error messages", () => {
    expect(formatProviderError(new Error("Choose a provider and model"))).toBe(
      "Choose a provider and model"
    )
  })

  it("returns plain strings", () => {
    expect(formatProviderError("  gateway timeout  ")).toBe("gateway timeout")
  })

  it("formats LoadAPIKeyError", () => {
    const error = new LoadAPIKeyError({
      message: "OpenAI API key is missing.",
    })
    expect(formatProviderError(error)).toBe("OpenAI API key is missing.")
  })

  it("formats APICallError with status, url, and body snippet", () => {
    const error = new APICallError({
      message: "Unauthorized",
      url: "http://gateway.local/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 401,
      responseBody: '{"error":{"message":"invalid api key"}}',
    })
    const text = formatProviderError(error)
    expect(text).toContain("Unauthorized")
    expect(text).toContain("HTTP 401")
    expect(text).toContain("http://gateway.local/v1/chat/completions")
    expect(text).toContain("invalid api key")
  })

  it("truncates very long response bodies", () => {
    const body = "x".repeat(500)
    const error = new APICallError({
      message: "Bad request",
      url: "http://example/v1",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: body,
    })
    const text = formatProviderError(error)
    expect(text.length).toBeLessThan(body.length + 80)
    expect(text.endsWith("…")).toBe(true)
  })

  it("falls back for unknown values", () => {
    expect(formatProviderError(null)).toBe("Unable to generate a response.")
    expect(formatProviderError({ weird: true })).toBe(
      "Unable to generate a response."
    )
  })
})
