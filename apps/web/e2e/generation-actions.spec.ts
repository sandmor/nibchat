import { expect, test } from "@playwright/test"
import { startMockLlm } from "./helpers/mock-llm"
import {
  ensureMockProvider,
  ensureWorkspace,
  expectAssistantText,
  openNewChat,
  sendMessage,
} from "./helpers/workspace"

test("sends an uploaded image and receives a reply", async ({ page }) => {
  const llm = await startMockLlm()
  try {
    await ensureWorkspace(page)
    await ensureMockProvider(page, llm.baseUrl)
    await openNewChat(page)
    await page.locator('input[type="file"]').setInputFiles({
      name: "tiny.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/h8sAAAAASUVORK5CYII=",
        "base64"
      ),
    })
    await expect(page.getByAltText("tiny.png")).toBeVisible()
    await expect(page.locator('span[aria-busy="true"]')).toHaveCount(0)

    llm.enqueue({ text: "IMAGE_REPLY" })
    await sendMessage(page, "Describe this image")
    await expectAssistantText(page, "IMAGE_REPLY")
    expect(llm.requestCount()).toBe(1)
    expect(JSON.stringify(llm.requestBodies()[0]?.messages)).toContain(
      "image_url"
    )
  } finally {
    await llm.close()
  }
})

test("a retried action streams the same durable generation", async ({
  page,
}) => {
  const llm = await startMockLlm()
  try {
    await ensureWorkspace(page)
    await ensureMockProvider(page, llm.baseUrl)
    await openNewChat(page)
    llm.enqueue({ text: "ACTION_SEED" }, { text: "ACTION_ONCE" })
    await sendMessage(page, "seed action chat")
    await expectAssistantText(page, "ACTION_SEED")
    await expect(page).toHaveURL(/\/chat\/(?!new)[^/]+$/, { timeout: 30_000 })

    const chatId = page.url().split("/").at(-1)!
    const actionId = crypto.randomUUID()
    const before = llm.requestCount()
    const result = await page.evaluate(
      async ({ chatId, actionId }) => {
        const body = JSON.stringify({
          actionId,
          chatId,
          intent: "submit",
          parentNodeId: null,
          content: "direct action",
          replyCount: 1,
          timeZone: "UTC",
        })
        const start = async () => {
          const response = await fetch("/api/chat/generations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          })
          const reader = response.body!.getReader()
          const first = await reader.read()
          await reader.cancel()
          const event = new TextDecoder()
            .decode(first.value)
            .split("\n")
            .find((line) => line.startsWith("data: "))
          return {
            status: response.status,
            contentType: response.headers.get("content-type"),
            started: event ? JSON.parse(event.slice(6)) : null,
          }
        }
        const first = await start()
        const retry = await start()
        const conflict = await fetch("/api/chat/generations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...JSON.parse(body),
            content: "different input",
          }),
        })
        return { first, retry, conflictStatus: conflict.status }
      },
      { chatId, actionId }
    )
    expect(result.first.status).toBe(200)
    expect(result.first.contentType).toContain("text/event-stream")
    expect(result.first.started?.type).toBe("action-started")
    expect(result.retry.started?.generations).toEqual(
      result.first.started?.generations
    )
    expect(result.first.started?.actionId).toBe(actionId)
    expect(result.conflictStatus).toBe(409)

    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/chat/generations/${actionId}`
          )
          const receipt = await response.json()
          return receipt.generations?.[0]?.status
        },
        { timeout: 30_000 }
      )
      .toBe("complete")
    expect(llm.requestCount() - before).toBe(1)

    // The stream adapter's five-second drain has passed; replay must now
    // recover the terminal snapshot from the durable action and message rows.
    await page.waitForTimeout(5_500)

    const replay = await page.evaluate(async (actionId) => {
      const response = await fetch(`/api/chat/generations/${actionId}/events`)
      return response.text()
    }, actionId)
    expect(replay).toContain('"type":"action-started"')
    expect(replay).toContain('"type":"terminal"')
    expect(replay).toContain('"type":"action-finished"')

    llm.enqueue({ text: "SIBLING_ONE" }, { text: "SIBLING_TWO" })
    const siblingCountBefore = llm.requestCount()
    const siblings = await page.evaluate(async (chatId) => {
      const response = await fetch("/api/chat/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionId: crypto.randomUUID(),
          chatId,
          intent: "submit",
          parentNodeId: null,
          content: "two sibling answers",
          replyCount: 2,
          timeZone: "UTC",
        }),
      })
      const events = (await response.text())
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)))
      return { status: response.status, events }
    }, chatId)
    expect(siblings.status).toBe(200)
    const manifest = siblings.events.find(
      (event: { type: string }) => event.type === "action-started"
    )
    expect(manifest.generations).toHaveLength(2)
    const terminalIds = siblings.events
      .filter(
        (event: { type: string; event?: { type: string } }) =>
          event.type === "generation-event" && event.event?.type === "terminal"
      )
      .map((event: { generationId: string }) => event.generationId)
    expect(new Set(terminalIds)).toEqual(
      new Set(
        manifest.generations.map(
          (item: { generationId: string }) => item.generationId
        )
      )
    )
    expect(siblings.events.at(-1)?.type).toBe("action-finished")
    expect(llm.requestCount() - siblingCountBefore).toBe(2)
  } finally {
    await llm.close()
  }
})
