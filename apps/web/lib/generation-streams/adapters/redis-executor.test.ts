import { afterEach, describe, expect, it, vi } from "vitest"
import {
  HttpRedisCommandExecutor,
  createRedisExecutor,
  redisTokenFromUrl,
  unwrapRedisHttpReply,
} from "@/lib/generation-streams/adapters/redis-executor"

describe("unwrapRedisHttpReply", () => {
  it("unwraps a result envelope", () => {
    expect(unwrapRedisHttpReply({ result: "OK" })).toBe("OK")
    expect(unwrapRedisHttpReply({ result: [["1-0", ["payload", "{}"]]] })).toEqual([
      ["1-0", ["payload", "{}"]],
    ])
  })

  it("throws on an error envelope", () => {
    expect(() => unwrapRedisHttpReply({ error: "inactive" })).toThrow("inactive")
  })

  it("passes through a raw Redis JSON reply", () => {
    expect(unwrapRedisHttpReply("OK")).toBe("OK")
    expect(unwrapRedisHttpReply(null)).toBeNull()
  })
})

describe("createRedisExecutor", () => {
  it("selects HTTP for http(s) URLs and TCP otherwise", () => {
    expect(createRedisExecutor("https://redis.example")).toBeInstanceOf(
      HttpRedisCommandExecutor
    )
    expect(createRedisExecutor("http://localhost:8080")).toBeInstanceOf(
      HttpRedisCommandExecutor
    )
    expect(createRedisExecutor("redis://localhost:6379")).not.toBeInstanceOf(
      HttpRedisCommandExecutor
    )
    expect(createRedisExecutor("rediss://localhost:6379")).not.toBeInstanceOf(
      HttpRedisCommandExecutor
    )
  })

  it("reads a token from URL userinfo", () => {
    expect(redisTokenFromUrl("https://s3cret@redis.example")).toBe("s3cret")
    expect(redisTokenFromUrl("https://default:s3cret@redis.example")).toBe("s3cret")
  })
})

describe("HttpRedisCommandExecutor", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("POSTs the command array and returns the unwrapped result", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://redis.example")
      expect(init?.method).toBe("POST")
      expect(JSON.parse(String(init?.body))).toEqual(["GET", "k"])
      const headers = new Headers(init?.headers)
      expect(headers.get("authorization")).toBe("Bearer tok")
      return new Response(JSON.stringify({ result: "v" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetch)
    const redis = new HttpRedisCommandExecutor("https://tok:ignored@redis.example/", "tok")
    expect(await redis.send(["GET", "k"])).toBe("v")
  })

  it("throws Redis errors from the HTTP envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "inactive" })))
    )
    const redis = new HttpRedisCommandExecutor("https://redis.example")
    await expect(redis.send(["EVAL", "return {err='inactive'}", "0"])).rejects.toThrow(
      "inactive"
    )
  })
})
