import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { startMockLlm, type MockLlm } from "./helpers/mock-llm"
import {
  ensureMockProvider,
  ensureWorkspace,
  expectAssistantText,
  openNewChat,
  sendMessage,
  streamingMarkers,
} from "./helpers/workspace"

test.describe.configure({ mode: "serial" })

test.describe("helper tool", () => {
  let context: BrowserContext
  let page: Page
  let llm: MockLlm

  test.beforeAll(async ({ browser }) => {
    llm = await startMockLlm()
    context = await browser.newContext()
    page = await context.newPage()
    await ensureWorkspace(page)
    await ensureMockProvider(page, llm.baseUrl)
  })
  test.afterAll(async () => {
    await context.close()
    await llm.close()
  })

  test("delegates with only a prompt and opens the child chat", async () => {
    await openNewChat(page)
    llm.enqueue(
      {
        text: "I will ask a helper.",
        toolCalls: [
          { name: "task", arguments: { prompt: "Summarize the harbor note." } },
        ],
      },
      { text: "CHILD_HARBOR_SUMMARY" },
      { text: "PARENT_SUMMARIZED_THE_TASK" }
    )
    await sendMessage(
      page,
      "The harbor is calm. Ask a helper to summarize this."
    )
    await expectAssistantText(page, "PARENT_SUMMARIZED_THE_TASK", {
      timeout: 30_000,
    })
    await expect(streamingMarkers(page)).toHaveCount(0)
    await expect(page.getByText("CHILD_HARBOR_SUMMARY")).toBeVisible()
    await page.getByRole("link", { name: "Open" }).click()
    await expect(page.getByText("Summarize the harbor note.")).toBeVisible()
    await expect(page.getByText("CHILD_HARBOR_SUMMARY")).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Back to parent" })
    ).toBeVisible()
  })

  test("uses a helper result to delegate again before answering", async () => {
    await openNewChat(page)
    llm.enqueue(
      {
        text: "Checking the first part.",
        toolCalls: [{ name: "task", arguments: { prompt: "Check part one." } }],
      },
      { text: "FIRST_HELPER_RESULT" },
      {
        text: "The first result needs another check.",
        toolCalls: [{ name: "task", arguments: { prompt: "Check part two." } }],
      },
      { text: "SECOND_HELPER_RESULT" },
      { text: "COMBINED_HELPER_ANSWER" }
    )
    await sendMessage(page, "Check both parts before answering.")
    await expectAssistantText(page, "COMBINED_HELPER_ANSWER", {
      timeout: 30_000,
    })
    await expect(page.getByText("FIRST_HELPER_RESULT")).toBeVisible()
    await expect(page.getByText("SECOND_HELPER_RESULT")).toBeVisible()
  })

  test("answers a helper question from the parent task card", async () => {
    await openNewChat(page)
    llm.enqueue(
      {
        text: "I will ask a helper.",
        toolCalls: [
          { name: "task", arguments: { prompt: "Ask for a color." } },
        ],
      },
      {
        text: "I need a choice.",
        toolCalls: [
          {
            name: "question",
            arguments: {
              questions: [
                {
                  question: "Which color should I use?",
                  header: "Color",
                  options: [
                    { label: "Blue", description: "Use blue." },
                    { label: "Green", description: "Use green." },
                  ],
                  multiple: false,
                  custom: false,
                },
              ],
            },
          },
        ],
      },
      { text: "HELPER_USED_BLUE" },
      { text: "PARENT_USED_HELPER_CHOICE" }
    )
    await sendMessage(page, "Ask a helper to pick a color with me.")
    await expect(page.getByText("Which color should I use?")).toBeVisible({
      timeout: 30_000,
    })
    await page.getByRole("radio", { name: /Blue/ }).check()
    await page.getByRole("button", { name: /Submit answers|Submit/i }).click()
    await expectAssistantText(page, "PARENT_USED_HELPER_CHOICE", {
      timeout: 30_000,
    })
  })

  test("queues a user message for a running helper", async () => {
    await openNewChat(page)
    llm.enqueue(
      {
        text: "I will ask a helper.",
        toolCalls: [{ name: "task", arguments: { prompt: "Draft a reply." } }],
      },
      { text: "CHILD_FIRST_DRAFT", hold: true },
      { text: "CHILD_REVISED_DRAFT" },
      { text: "PARENT_USED_REVISED_DRAFT" }
    )
    await sendMessage(page, "Ask a helper to draft this.")
    const message = page.getByRole("textbox", { name: "Message helper" })
    await expect(message).toBeVisible({ timeout: 30_000 })
    await message.fill("Please make the draft shorter.")
    const queuedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/agent-runs\//.test(response.url())
    )
    await message.locator("..").getByRole("button", { name: "Send" }).click()
    expect((await queuedResponse).ok()).toBe(true)
    llm.release()
    await expectAssistantText(page, "PARENT_USED_REVISED_DRAFT", {
      timeout: 30_000,
    })
    await expect(page.getByText("CHILD_REVISED_DRAFT")).toBeVisible()
  })

  test("stops one running helper and returns control to the parent", async () => {
    await openNewChat(page)
    llm.enqueue(
      {
        text: "I will ask a helper.",
        toolCalls: [{ name: "task", arguments: { prompt: "Long task." } }],
      },
      { text: "SHOULD_NOT_FINISH", hold: true },
      { text: "PARENT_AFTER_STOP" }
    )
    await sendMessage(page, "Ask a helper, then let me stop it.")
    const open = page.getByRole("link", { name: "Open" })
    await expect(open).toBeVisible({ timeout: 30_000 })
    await open.locator("..").getByRole("button", { name: "Stop" }).click()
    await expectAssistantText(page, "PARENT_AFTER_STOP", {
      timeout: 30_000,
    })
    await expect(page.getByText("Stopped", { exact: true })).toBeVisible()
  })

  test("shows a clear error when the configured model-step limit is reached", async () => {
    await page.goto("/settings")
    const limit = page.getByLabel("Model steps per reply")
    await expect(limit).toBeVisible()
    await limit.fill("1")
    await limit.blur()
    await expect(limit).toHaveValue("1")

    await openNewChat(page)
    llm.enqueue(
      {
        text: "Delegating one task.",
        toolCalls: [
          { name: "task", arguments: { prompt: "Check the limit." } },
        ],
      },
      { text: "HELPER_LIMIT_RESULT" }
    )
    await sendMessage(page, "Ask a helper before answering.")
    await expect(
      page.getByText("Model step limit (1) reached before a final answer.")
    ).toBeVisible({ timeout: 30_000 })
  })
})
