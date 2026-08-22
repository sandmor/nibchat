import { describe, expect, it } from "vitest"
import { parseRedisStreamEntries } from "@/lib/generation-streams/adapters/redis-codec"

describe("parseRedisStreamEntries", () => {
  it("reads payload fields from an XRANGE reply", () => {
    expect(
      parseRedisStreamEntries([
        ["1710000000000-0", ["payload", '{"type":"text-delta","delta":"Hi"}']],
        ["1710000000001-0", ["payload", '{"type":"text-delta","delta":"!"}']],
      ])
    ).toEqual([
      { cursor: "1710000000000-0", payload: { type: "text-delta", delta: "Hi" } },
      { cursor: "1710000000001-0", payload: { type: "text-delta", delta: "!" } },
    ])
  })

  it("skips corrupt entries without dropping the rest of the page", () => {
    expect(
      parseRedisStreamEntries([
        ["1-0", ["payload", "not-json"]],
        ["2-0", ["payload", '{"type":"text-delta","delta":"ok"}']],
        ["bad"],
      ])
    ).toEqual([
      { cursor: "2-0", payload: { type: "text-delta", delta: "ok" } },
    ])
  })
})
