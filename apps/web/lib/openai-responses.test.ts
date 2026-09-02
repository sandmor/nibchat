import { describe, expect, it } from "vitest"
import {
  openAIResponsesModel,
  protocolRoutedModel,
} from "@/lib/openai-responses"

function responsesThenChat(
  primary: ReturnType<typeof model>,
  fallback: ReturnType<typeof model>,
  allowFallback = true
) {
  return protocolRoutedModel({
    candidates: [
      { protocol: "responses", model: primary },
      { protocol: "chat", model: fallback },
    ],
    allowFallback,
  })
}

function model(overrides: Partial<any> = {}) {
  return {
    specificationVersion: "v4" as const,
    provider: "test",
    modelId: "test-model",
    doGenerate: async () => ({ text: "primary" }),
    doStream: async () => ({ stream: new ReadableStream() }),
    ...overrides,
  }
}

describe("OpenAI Responses models", () => {
  it("uses stateless replay and removes hidden response chains", async () => {
    let received: any
    const wrapped = openAIResponsesModel({
      model: model({
        doGenerate: async (input: any) => ((received = input), {}),
      }),
      promptCacheKey: "chat-key",
      defaultReasoningSummary: true,
    }) as any
    await wrapped.doGenerate({
      providerOptions: {
        openai: { previousResponseId: "hidden", conversation: "hidden" },
      },
    })
    expect(received.providerOptions.openai).toMatchObject({
      store: false,
      promptCacheKey: "chat-key",
      reasoningSummary: "auto",
    })
    expect(received.providerOptions.openai.include).toContain(
      "reasoning.encrypted_content"
    )
    expect(received.providerOptions.openai).not.toHaveProperty(
      "previousResponseId"
    )
    expect(received.providerOptions.openai).not.toHaveProperty("conversation")
  })

  it("does not allow a stored-response override", async () => {
    let received: any
    const wrapped = openAIResponsesModel({
      model: model({
        doGenerate: async (input: any) => ((received = input), {}),
      }),
    }) as any
    await wrapped.doGenerate({ providerOptions: { openai: { store: true } } })
    expect(received.providerOptions.openai.store).toBe(false)
  })

  it("falls back only for a missing Responses endpoint", async () => {
    let fallbackCalls = 0
    const wrapped = responsesThenChat(
      model({
        doGenerate: async () => {
          throw { statusCode: 404, message: "route not found" }
        },
      }),
      model({
        doGenerate: async () => (fallbackCalls++, { text: "chat" }),
      })
    ) as any
    await expect(wrapped.doGenerate({})).resolves.toMatchObject({
      text: "chat",
    })
    expect(fallbackCalls).toBe(1)
  })

  it("strips Responses reasoning and metadata for a Chat fallback", async () => {
    let received: any
    const wrapped = responsesThenChat(
      model({
        doGenerate: async () => {
          throw { statusCode: 404, message: "route not found" }
        },
      }),
      model({
        doGenerate: async (input: any) => ((received = input), { text: "ok" }),
      })
    ) as any
    await wrapped.doGenerate({
      prompt: [
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "private" },
            {
              type: "text",
              text: "visible",
              providerOptions: { openai: { itemId: "msg_1" } },
            },
          ],
        },
      ],
    })
    expect(received.prompt[0].content).toEqual([
      { type: "text", text: "visible" },
    ])
  })

  it("falls back when a provider rejects Responses input items", async () => {
    const wrapped = responsesThenChat(
      model({
        doGenerate: async () => {
          throw {
            statusCode: 400,
            message:
              "Unsupported Responses API input item type: item_reference",
          }
        },
      }),
      model()
    ) as any
    await expect(wrapped.doGenerate({})).resolves.toEqual({ text: "primary" })
  })

  it("falls back after the SDK wraps a retryable Responses 500", async () => {
    const wrapped = responsesThenChat(
      model({
        doGenerate: async () => {
          throw {
            errors: [
              {
                statusCode: 500,
                responseBody: '{"error":{"message":"Internal server error"}}',
              },
            ],
          }
        },
      }),
      model()
    ) as any
    await expect(wrapped.doGenerate({})).resolves.toEqual({ text: "primary" })
  })

  it("does not apply the masked-400 heuristic outside Auto Responses to Chat", async () => {
    let fallbackCalls = 0
    const failure = {
      statusCode: 400,
      responseBody: '{"error":{"message":"Internal server error"}}',
    }
    const explicitResponses = protocolRoutedModel({
      candidates: [
        {
          protocol: "responses",
          model: model({ doGenerate: async () => Promise.reject(failure) }),
        },
        {
          protocol: "chat",
          model: model({
            doGenerate: async () => (fallbackCalls++, { text: "chat" }),
          }),
        },
      ],
      allowFallback: false,
    }) as any
    await expect(explicitResponses.doGenerate({})).rejects.toBe(failure)

    const chatFirst = protocolRoutedModel({
      candidates: [
        {
          protocol: "chat",
          model: model({ doGenerate: async () => Promise.reject(failure) }),
        },
        {
          protocol: "responses",
          model: model({
            doGenerate: async () => (fallbackCalls++, { text: "responses" }),
          }),
        },
      ],
      allowFallback: true,
    }) as any
    await expect(chatFirst.doGenerate({})).rejects.toBe(failure)
    expect(fallbackCalls).toBe(0)
  })
})
