/** One Redis command as a RESP array. Both TCP and HTTP executors speak this. */
export type RedisCommandExecutor = {
  send(args: readonly string[]): Promise<unknown>
}

export function redisTokenFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.password || (parsed.username ? parsed.username : undefined)
  } catch {
    return undefined
  }
}

export function createRedisExecutor(
  url: string,
  token?: string
): RedisCommandExecutor {
  const resolved = token ?? process.env.REDIS_TOKEN ?? redisTokenFromUrl(url)
  if (url.startsWith("http://") || url.startsWith("https://"))
    return new HttpRedisCommandExecutor(url, resolved)
  return new TcpRedisCommandExecutor(url)
}

/**
 * POST a Redis command array. Compatible with HTTP Redis gateways that accept
 * `["COMMAND", ...args]` and optionally wrap the reply as `{ result }` / `{ error }`.
 */
export class HttpRedisCommandExecutor implements RedisCommandExecutor {
  private readonly endpoint: string

  constructor(
    url: string,
    private readonly token?: string
  ) {
    const parsed = new URL(url)
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "")
    this.endpoint = `${parsed.protocol}//${parsed.host}${path}`
  }

  async send(args: readonly string[]): Promise<unknown> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    }
    if (this.token) headers.authorization = `Bearer ${this.token}`
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(args),
    })
    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message =
        unwrapRedisHttpError(body) ?? `${response.status} ${response.statusText}`
      throw new Error(message)
    }
    return unwrapRedisHttpReply(body)
  }
}

export function unwrapRedisHttpReply(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>
    if (typeof record.error === "string") throw new Error(record.error)
    if ("result" in record) return record.result
  }
  return body
}

function unwrapRedisHttpError(body: unknown): string | null {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as Record<string, unknown>).error
    if (typeof error === "string") return error
  }
  return null
}

class TcpRedisCommandExecutor implements RedisCommandExecutor {
  private clientPromise: Promise<{
    sendCommand: (args: string[]) => Promise<unknown>
  }> | null = null

  constructor(private readonly url: string) {}

  async send(args: readonly string[]): Promise<unknown> {
    const client = await this.connect()
    return client.sendCommand([...args])
  }

  private connect() {
    this.clientPromise ??= import("redis").then(async ({ createClient }) => {
      const client = createClient({ url: this.url })
      client.on("error", (error) =>
        console.error("[nibchat/generation-redis]", error)
      )
      await client.connect()
      return client
    })
    return this.clientPromise
  }
}
