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

test("sends branch from unfinished context and mixed versions navigate and delete together", async ({
  page,
}) => {
  const llm = await startMockLlm()
  try {
    await ensureWorkspace(page)
    await ensureMockProvider(page, llm.baseUrl)
    await openNewChat(page)
    llm.enqueue({ text: "FINISHED_SEED" })
    await sendMessage(page, "seed branching chat")
    await expectAssistantText(page, "FINISHED_SEED")
    const chatId = page.url().split("/").at(-1)!
    type Node = {
      id: string
      parent_id: string | null
      role: string
      status: string
      parts_json: string
    }
    const workspace = async (): Promise<{ nodes: Node[] }> => {
      const response = await page.request.get(
        `/api/trpc/workspace.get?input=${encodeURIComponent(JSON.stringify({ chatId }))}`
      )
      expect(response.ok()).toBe(true)
      return (await response.json()).result.data
    }
    const withText = (nodes: Node[], text: string) =>
      nodes.find((node) => node.parts_json.includes(text))!

    llm.enqueue(
      { text: "UNFINISHED_FIRST", holdAfterText: true },
      { text: "UNFINISHED_SECOND", holdAfterText: true },
      { text: "NEW_BRANCH_REPLY" }
    )
    await sendMessage(page, "shared generation context")
    await expectAssistantText(page, "UNFINISHED_FIRST")
    await sendMessage(page, "")
    await expectAssistantText(page, "UNFINISHED_SECOND")
    await sendMessage(page, "new user branch")
    await expectAssistantText(page, "NEW_BRANCH_REPLY")

    const { nodes } = await workspace()
    const parent = withText(nodes, "shared generation context")
    const userBranch = withText(nodes, "new user branch")
    const siblings = nodes.filter((node) => node.parent_id === parent.id)
    expect(siblings.map((node) => node.role)).toEqual([
      "assistant",
      "assistant",
      "user",
    ])
    expect(
      siblings.slice(0, 2).every((node) => node.status === "streaming")
    ).toBe(true)
    for (const sibling of siblings.slice(0, 2))
      expect(nodes.some((node) => node.parent_id === sibling.id)).toBe(false)
    expect(withText(nodes, "NEW_BRANCH_REPLY").parent_id).toBe(userBranch.id)
    for (const request of llm.requestBodies().slice(-2)) {
      const messages = JSON.stringify(request.messages)
      expect(messages).toContain("shared generation context")
      expect(messages).not.toContain("UNFINISHED_FIRST")
      expect(messages).not.toContain("UNFINISHED_SECOND")
    }

    const userRow = page
      .locator(
        'article[data-theme-target="message-user"]:has([data-slot-layer="present"])'
      )
      .filter({ hasText: "new user branch" })
    await userRow.getByRole("button", { name: "Previous branch" }).click()
    await expectAssistantText(page, "UNFINISHED_SECOND")
    const secondRow = page
      .locator(
        'article[data-theme-target="message-assistant"]:has([data-slot-layer="present"])'
      )
      .filter({ hasText: "UNFINISHED_SECOND" })
    await secondRow.getByRole("button", { name: "Previous branch" }).click()
    await expectAssistantText(page, "UNFINISHED_FIRST")
    const firstRow = page
      .locator(
        'article[data-theme-target="message-assistant"]:has([data-slot-layer="present"])'
      )
      .filter({ hasText: "UNFINISHED_FIRST" })
    await firstRow.getByRole("button", { name: "Next branch" }).click()
    await expectAssistantText(page, "UNFINISHED_SECOND")
    await secondRow.getByRole("button", { name: "Next branch" }).click()
    await expectAssistantText(page, "NEW_BRANCH_REPLY")

    // Starting a send must not overwrite a version selected during startup.
    llm.enqueue({ text: "NAVIGATED_REPLY" })
    let releaseStart!: () => void
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    await page.route("**/api/chat/generations", async (route) => {
      await startGate
      await route.continue()
    })
    const pendingStart = page.waitForRequest((request) =>
      request.url().endsWith("/api/chat/generations")
    )
    await sendMessage(page, "send before navigating away")
    await pendingStart
    await userRow.getByRole("button", { name: "Previous branch" }).click()
    await expectAssistantText(page, "UNFINISHED_SECOND")
    releaseStart()
    await expect.poll(() => llm.requestCount()).toBe(5)
    await expect
      .poll(async () =>
        (await workspace()).nodes.some((node) =>
          node.parts_json.includes("NAVIGATED_REPLY")
        )
      )
      .toBe(true)
    await expectAssistantText(page, "UNFINISHED_SECOND")
    await expect(
      page
        .locator('[data-slot-layer="present"]')
        .filter({ hasText: "NAVIGATED_REPLY" })
    ).toHaveCount(0)
    await page.unroute("**/api/chat/generations")
    await secondRow.getByRole("button", { name: "Next branch" }).click()
    await expectAssistantText(page, "NEW_BRANCH_REPLY")
    await userRow.getByRole("button", { name: "Delete", exact: true }).click()
    await page
      .getByRole("button", { name: "Delete all versions", exact: true })
      .click()
    await expect
      .poll(
        async () =>
          (await workspace()).nodes.filter(
            (node) => node.parent_id === parent.id
          ).length
      )
      .toBe(0)
    expect(
      (await workspace()).nodes.some((node) => node.id === parent.id)
    ).toBe(true)
  } finally {
    await llm.close()
  }
})
