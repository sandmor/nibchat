import http from "node:http"
import type { AddressInfo } from "node:net"

export type MockToolCallPlan = {
  /** Function name exposed as a tool (e.g. question). */
  name: string
  /** JSON-serializable arguments object. */
  arguments: unknown
  id?: string
}

export type MockCompletionPlan = {
  /** Visible assistant text written into the stream. */
  text: string
  /**
   * When true, the stream opens (client shows streaming UI) then waits until
   * `release()` before emitting tokens and finishing.
   */
  hold?: boolean
  /**
   * When set, the response finishes with `tool_calls` instead of text stop.
   * Text is still emitted first when non-empty.
   */
  toolCalls?: MockToolCallPlan[]
}

export type MockLlm = {
  baseUrl: string
  /** Enqueue completion scripts in the order streams are accepted. */
  enqueue: (...plans: MockCompletionPlan[]) => void
  /** Release the oldest held stream (if any). */
  release: () => void
  /** How many chat-completion requests were accepted. */
  requestCount: () => number
  close: () => Promise<void>
}

/**
 * Minimal OpenAI-compatible chat Completions server for Playwright e2e.
 * Supports streaming (`stream: true`) used by the AI SDK openai-compatible adapter.
 */
export async function startMockLlm(): Promise<MockLlm> {
  const queue: MockCompletionPlan[] = []
  const releaseWaiters: Array<() => void> = []
  let requests = 0

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? ""
    // Catalog probe from /api/models (optional).
    if (req.method === "GET" && /\/models\/?$/.test(url.split("?")[0] ?? "")) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ data: [{ id: "e2e-model" }] }))
      return
    }

    if (
      req.method === "POST" &&
      /\/chat\/completions\/?$/.test(url.split("?")[0] ?? "")
    ) {
      const body = await readBody(req)
      let streamed = true
      try {
        streamed = JSON.parse(body).stream !== false
      } catch {
        /* default stream */
      }

      requests += 1
      const plan = queue.shift() ?? {
        text: `mock-reply-${requests}`,
      }

      if (!streamed) {
        if (plan.toolCalls?.length) {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(
            JSON.stringify({
              id: `chatcmpl-e2e-${requests}`,
              object: "chat.completion",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: plan.text || null,
                    tool_calls: plan.toolCalls.map((call, index) => ({
                      id: call.id ?? `call_e2e_${requests}_${index}`,
                      type: "function",
                      function: {
                        name: call.name,
                        arguments: JSON.stringify(call.arguments),
                      },
                    })),
                  },
                  finish_reason: "tool_calls",
                },
              ],
            })
          )
          return
        }
        res.writeHead(200, { "content-type": "application/json" })
        res.end(
          JSON.stringify({
            id: `chatcmpl-e2e-${requests}`,
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: plan.text },
                finish_reason: "stop",
              },
            ],
          })
        )
        return
      }

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })

      // Flush headers so the client can register the stream UI before we hold.
      res.write(": ok\n\n")

      if (plan.hold) {
        await new Promise<void>((resolve) => {
          releaseWaiters.push(resolve)
        })
      }

      // Role chunk then content (matches common OpenAI streaming shape).
      writeChunk(res, { role: "assistant", content: "" })
      if (plan.text) {
        for (const part of chunkText(plan.text, 12)) {
          writeChunk(res, { content: part })
          await sleep(8)
        }
      }

      if (plan.toolCalls?.length) {
        for (const [index, call] of plan.toolCalls.entries()) {
          const id = call.id ?? `call_e2e_${requests}_${index}`
          const args = JSON.stringify(call.arguments)
          writeChunk(res, {
            tool_calls: [
              {
                index,
                id,
                type: "function",
                function: { name: call.name, arguments: "" },
              },
            ],
          })
          for (const part of chunkText(args, 40)) {
            writeChunk(res, {
              tool_calls: [
                {
                  index,
                  function: { arguments: part },
                },
              ],
            })
            await sleep(4)
          }
        }
        writeChunk(res, {}, "tool_calls")
      } else {
        writeChunk(res, {}, "stop")
      }
      res.write("data: [DONE]\n\n")
      res.end()
      return
    }

    res.writeHead(404).end("not found")
  })

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const { port } = server.address() as AddressInfo
  // Trailing path segment some clients join as …/v1/chat/completions
  const baseUrl = `http://127.0.0.1:${port}/v1`

  return {
    baseUrl,
    enqueue: (...plans) => {
      queue.push(...plans)
    },
    release: () => {
      const next = releaseWaiters.shift()
      next?.()
    },
    requestCount: () => requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function writeChunk(
  res: http.ServerResponse,
  delta: Record<string, unknown>,
  finishReason: string | null = null
) {
  const payload = {
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function chunkText(text: string, size: number) {
  const parts: string[] = []
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size))
  return parts.length ? parts : [""]
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(Buffer.from(c)))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
