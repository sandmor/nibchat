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

const questionToolCall = {
  name: "question",
  arguments: {
    questions: [
      {
        question: "What should the agent build next?",
        header: "Next feature",
        options: [
          {
            label: "Tool timeline (Recommended)",
            description: "Show tool call timeline.",
          },
          {
            label: "Checkpoints",
            description: "Ask before sensitive actions.",
          },
        ],
        multiple: false,
        custom: true,
      },
    ],
  },
}

function presentTranscript(page: Page) {
  return page.locator('[data-slot-layer="present"]')
}

async function chooseAnswer(page: Page, name: RegExp) {
  await expect(async () => {
    const radio = page.getByRole("radio", { name })
    await radio.check({ timeout: 1_000 })
    await expect(radio).toBeChecked()
    await expect(radio.locator("..")).toHaveAttribute("data-checked", "")
  }).toPass({ timeout: 15_000 })
}

test.describe("question tool", () => {
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

  test("asks questions then continues after answers", async () => {
    await openNewChat(page)

    llm.enqueue(
      {
        text: "I have a question for you.",
        toolCalls: [questionToolCall],
      },
      { text: "QUESTION_DONE_WITH_ANSWERS" }
    )

    await sendMessage(page, "Please ask me something")

    // Streaming ends; questionnaire persists on awaiting_input assistant.
    await expect(streamingMarkers(page)).toHaveCount(0, { timeout: 30_000 })
    await expect(
      page.getByText("What should the agent build next?")
    ).toBeVisible({
      timeout: 15_000,
    })

    const assistant = page.locator("article").filter({
      has: page.getByText("assistant", { exact: false }),
    })
    // Toolful turns hide free-text edit; user messages may still offer it.
    await expect(
      assistant.getByRole("button", { name: "Edit as branch" })
    ).toHaveCount(0)
    await expect(page.getByText("waiting for input")).toBeVisible()

    await chooseAnswer(page, /Tool timeline \(Recommended\)/)
    await page.getByRole("button", { name: /Submit answers|Submit/i }).click()

    await expectAssistantText(page, "QUESTION_DONE_WITH_ANSWERS", {
      timeout: 30_000,
    })
    const transcript = presentTranscript(page)
    await expect(
      transcript.getByText("Questions answered", { exact: true })
    ).toBeVisible()
    await expect(
      transcript.getByText("Tool timeline (Recommended)", { exact: true })
    ).toBeVisible()
  })

  test("allows skipping optional questions", async () => {
    await openNewChat(page)

    llm.enqueue(
      {
        text: "Optional only.",
        toolCalls: [questionToolCall],
      },
      { text: "QUESTION_SKIPPED_OK" }
    )

    await sendMessage(page, "Ask me optionally")
    await expect(streamingMarkers(page)).toHaveCount(0, { timeout: 30_000 })
    await expect(
      page.getByText("What should the agent build next?")
    ).toBeVisible({
      timeout: 15_000,
    })

    // required:false + Skip on last item auto-submits empty answers → Unanswered
    await page.getByRole("button", { name: /^Skip$/i }).click()

    await expectAssistantText(page, "QUESTION_SKIPPED_OK", {
      timeout: 30_000,
    })
    const transcript = presentTranscript(page)
    await expect(
      transcript.getByText("Questions answered", { exact: true })
    ).toBeVisible()
    await expect(
      transcript.getByText("Unanswered", { exact: true })
    ).toBeVisible()
  })

  test("awaiting question survives tab close and continues after reopening", async () => {
    await openNewChat(page)

    llm.enqueue(
      {
        text: "Quick checkpoint.",
        toolCalls: [
          {
            name: "question",
            arguments: {
              questions: [
                {
                  question: "Resume after disconnect?",
                  header: "Resume",
                  options: [
                    {
                      label: "Yes continue (Recommended)",
                      description: "Pick this after reopening the tab.",
                    },
                    {
                      label: "No",
                      description: "Should not be selected.",
                    },
                  ],
                  multiple: false,
                  custom: false,
                },
              ],
            },
          },
        ],
      },
      { text: "RESUMED_AFTER_TAB_CLOSE" }
    )

    await sendMessage(page, "Ask me then I will leave")
    await expect(streamingMarkers(page)).toHaveCount(0, { timeout: 30_000 })
    await expect(page.getByText("Resume after disconnect?")).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText("waiting for input")).toBeVisible()

    // Durable checkpoint: nothing is streaming; tab may disconnect.
    const chatUrl = page.url()
    expect(chatUrl).toMatch(/\/chat\/[a-f0-9-]+/i)

    await page.close()
    page = await context.newPage()
    await page.goto(chatUrl)

    // Progress from the paused tool call is restored from the DB.
    await expect(page.getByText("Resume after disconnect?")).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText("waiting for input")).toBeVisible()
    await expect(page.getByText("Quick checkpoint.")).toBeVisible()

    await chooseAnswer(page, /Yes continue \(Recommended\)/)
    await page.getByRole("button", { name: /Submit answers|Submit/i }).click()

    await expectAssistantText(page, "RESUMED_AFTER_TAB_CLOSE", {
      timeout: 30_000,
    })
    const transcript = presentTranscript(page)
    await expect(
      transcript.getByText("Questions answered", { exact: true })
    ).toBeVisible()
    await expect(
      transcript.getByText("Yes continue (Recommended)", { exact: true })
    ).toBeVisible()
  })
})
