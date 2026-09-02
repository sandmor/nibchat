import { describe, expect, it } from "vitest"
import { reduceGenerationPayload } from "@/lib/generation-streams/events"
import type { Parts } from "@/lib/agent/parts"

describe("reduceGenerationPayload", () => {
  it("keeps repeated provider stream IDs separate when the producer namespaces them", () => {
    let parts: Parts = []
    const apply = (event: Parameters<typeof reduceGenerationPayload>[1]) => {
      parts = reduceGenerationPayload(parts, event)
    }

    apply({ type: "text-start", id: "text-1" })
    apply({ type: "text-delta", id: "text-1", delta: "Before tool" })
    apply({
      type: "tool-upsert",
      tool: {
        type: "tool-invocation",
        toolCallId: "call-1",
        toolName: "lookup",
        state: "output-available",
        input: {},
        output: "result",
      },
    })
    // The provider reused txt-0 in a later streamText step. Its app-local
    // ID is different, so its delta cannot mutate the earlier text part.
    apply({ type: "text-start", id: "text-2" })
    apply({ type: "text-delta", id: "text-2", delta: "After tool" })

    expect(parts).toMatchObject([
      { type: "text", text: "Before tool", streamId: "text-1" },
      { type: "tool-invocation", toolCallId: "call-1" },
      { type: "text", text: "After tool", streamId: "text-2" },
    ])
  })
})
