import "server-only"
import { parseRedisStreamEntries } from "@/lib/generation-streams/adapters/redis-codec"
import {
  createRedisExecutor,
  type RedisCommandExecutor,
} from "@/lib/generation-streams/adapters/redis-executor"
import {
  followRedisGenerationLog,
  type RedisGenerationMeta,
} from "@/lib/generation-streams/adapters/redis-subscribe"
import { collectPages } from "@/lib/generation-streams/pages"
import {
  GENERATION_LEASE_MS,
  GENERATION_LEASE_RENEW_MS,
  GENERATION_REDIS_IDLE_POLL_MS,
} from "@/lib/generation-streams/policy"
import type {
  GenerationEvent,
  GenerationProducer,
  GenerationStreamMeta,
  GenerationStreamPort,
  GenerationStreamSnapshot,
} from "@/lib/generation-streams/ports"

const RETENTION_MS = 5 * 60_000
const DRAIN_MS = 5_000
const PAGE_SIZE = 100

type Meta = GenerationStreamMeta & RedisGenerationMeta

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : value == null ? null : String(value)
}

/** Shared adapter: one command executor, no per-subscriber connections. */
export class RedisGenerationStreamPort implements GenerationStreamPort {
  private readonly leases = new Map<string, ReturnType<typeof setInterval>>()

  constructor(
    private readonly redis: RedisCommandExecutor,
    private readonly prefix = "nibchat:generation"
  ) {}

  static fromUrl(url: string, token?: string) {
    return new RedisGenerationStreamPort(createRedisExecutor(url, token))
  }

  private key(id: string, suffix: "meta" | "events" | "cancel" | "lease") {
    return `${this.prefix}:${id}:${suffix}`
  }

  private async getMeta(id: string): Promise<Meta | null> {
    const raw = asString(await this.redis.send(["GET", this.key(id, "meta")]))
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Meta
      return { ...parsed, seq: Number(parsed.seq) || 0 }
    } catch {
      return null
    }
  }

  private async readPage(id: string, after: string | null) {
    const raw = await this.redis.send([
      "XRANGE",
      this.key(id, "events"),
      after ? `(${after}` : "-",
      "+",
      "COUNT",
      String(PAGE_SIZE),
    ])
    return parseRedisStreamEntries(raw)
  }

  private startLease(producer: GenerationProducer) {
    this.stopLease(producer.generationId)
    void this.heartbeat(producer).catch((error) =>
      console.error("[nibchat/generation-heartbeat]", error)
    )
    const timer = setInterval(() => {
      void this.heartbeat(producer).catch((error) =>
        console.error("[nibchat/generation-heartbeat]", error)
      )
    }, GENERATION_LEASE_RENEW_MS)
    timer.unref?.()
    this.leases.set(producer.generationId, timer)
  }

  private stopLease(generationId: string) {
    const timer = this.leases.get(generationId)
    if (!timer) return
    clearInterval(timer)
    this.leases.delete(generationId)
  }

  async open(meta: GenerationStreamMeta): Promise<GenerationProducer> {
    const token = crypto.randomUUID()
    const value: Meta = { ...meta, token, status: "open", seq: 0 }
    const created = asString(
      await this.redis.send([
        "SET",
        this.key(meta.generationId, "meta"),
        JSON.stringify(value),
        "NX",
        "PX",
        String(RETENTION_MS),
      ])
    )
    if (created !== "OK") throw new Error("Generation stream already exists")
    const lease = asString(
      await this.redis.send([
        "SET",
        this.key(meta.generationId, "lease"),
        token,
        "NX",
        "PX",
        String(GENERATION_LEASE_MS),
      ])
    )
    if (lease !== "OK") {
      await this.redis.send(["DEL", this.key(meta.generationId, "meta")])
      throw new Error("Generation stream lease already exists")
    }
    const producer = {
      generationId: meta.generationId,
      token,
    } satisfies GenerationProducer
    this.startLease(producer)
    return producer
  }

  private async fenced(
    producer: GenerationProducer,
    operation: "append" | "heartbeat" | "close",
    payload?: unknown
  ) {
    const id = producer.generationId
    const script = `
      local raw = redis.call('GET', KEYS[1])
      if not raw then return {err='inactive'} end
      local meta = cjson.decode(raw)
      if meta.status ~= 'open' or meta.token ~= ARGV[1] then return {err='inactive'} end
      if redis.call('GET', KEYS[2]) ~= ARGV[1] then return {err='inactive'} end
      if ARGV[2] == 'append' then
        if redis.call('EXISTS', KEYS[4]) == 1 then return {err='cancelled'} end
        local cursor = redis.call('XADD', KEYS[3], '*', 'payload', ARGV[3])
        meta.seq = (tonumber(meta.seq) or 0) + 1
        redis.call('SET', KEYS[1], cjson.encode(meta), 'PX', tonumber(ARGV[4]))
        redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[4]))
        redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[5]))
        return cursor
      end
      if ARGV[2] == 'heartbeat' then
        redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[5]))
        redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[4]))
        redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[4]))
        if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], tonumber(ARGV[4])) end
        return 'ok'
      end
      meta.status = 'closed'
      redis.call('SET', KEYS[1], cjson.encode(meta), 'PX', tonumber(ARGV[6]))
      redis.call('DEL', KEYS[2])
      redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[6]))
      if redis.call('EXISTS', KEYS[4]) == 1 then redis.call('PEXPIRE', KEYS[4], tonumber(ARGV[6])) end
      return 'ok'
    `
    return this.redis.send([
      "EVAL",
      script,
      "4",
      this.key(id, "meta"),
      this.key(id, "lease"),
      this.key(id, "events"),
      this.key(id, "cancel"),
      producer.token,
      operation,
      payload == null ? "" : JSON.stringify(payload),
      String(RETENTION_MS),
      String(GENERATION_LEASE_MS),
      String(DRAIN_MS),
    ])
  }

  async append(
    producer: GenerationProducer,
    payload: GenerationEvent["payload"]
  ) {
    return String(await this.fenced(producer, "append", payload))
  }

  async heartbeat(producer: GenerationProducer) {
    await this.fenced(producer, "heartbeat")
  }

  async close(producer: GenerationProducer) {
    this.stopLease(producer.generationId)
    await this.fenced(producer, "close")
  }

  async inspect(generationId: string): Promise<GenerationStreamSnapshot> {
    const meta = await this.getMeta(generationId)
    if (!meta) return { state: "missing", cancelled: false }
    const cancelled = await this.isCancelled(generationId)
    if (meta.status === "closed") return { state: "closed", cancelled }
    const live = asString(
      await this.redis.send(["GET", this.key(generationId, "lease")])
    )
    return { state: live === meta.token ? "open" : "orphaned", cancelled }
  }

  async *subscribe(
    generationId: string,
    after: string | null,
    signal: AbortSignal
  ) {
    yield* followRedisGenerationLog({
      after,
      signal,
      pollMs: GENERATION_REDIS_IDLE_POLL_MS,
      readMeta: () => this.getMeta(generationId),
      readLease: async () =>
        asString(await this.redis.send(["GET", this.key(generationId, "lease")])),
      readPage: (cursor) => this.readPage(generationId, cursor),
    })
  }

  async replay(generationId: string) {
    return collectPages(
      (after) => this.readPage(generationId, after),
      (event) => event.cursor
    )
  }

  async requestCancel(generationId: string) {
    await this.redis.send([
      "SET",
      this.key(generationId, "cancel"),
      "1",
      "PX",
      String(RETENTION_MS),
    ])
  }

  async isCancelled(generationId: string) {
    return Number(await this.redis.send(["EXISTS", this.key(generationId, "cancel")])) > 0
  }

  async discard(generationId: string) {
    this.stopLease(generationId)
    await this.redis.send([
      "DEL",
      this.key(generationId, "meta"),
      this.key(generationId, "lease"),
      this.key(generationId, "events"),
      this.key(generationId, "cancel"),
    ])
  }
}
