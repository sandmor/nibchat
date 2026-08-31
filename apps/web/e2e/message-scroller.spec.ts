import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { startMockLlm, type MockLlm } from "./helpers/mock-llm"
import {
  editUserAsBranch,
  ensureMockProvider,
  ensureWorkspace,
  expectAssistantText,
  expectUserMessage,
  openNewChat,
  sendMessage,
  streamingMarkers,
} from "./helpers/workspace"

test.describe.configure({ mode: "serial" })

test.describe("message scroller transcript", () => {
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

  test("auto-follows stream at live edge and reattaches via jump-to-end", async () => {
    await openNewChat(page)

    const longReply =
      "SCROLL_MARKER_START " +
      Array.from(
        { length: 80 },
        (_, i) => `paragraph-${i} streaming filler line for height.`
      ).join(" ") +
      " SCROLL_MARKER_END"

    llm.enqueue({ text: longReply, hold: true })
    await sendMessage(page, "please stream a tall reply")
    await expect(streamingMarkers(page)).toHaveCount(1, { timeout: 15_000 })

    const viewport = page.getByTestId("chat-transcript-viewport")
    await expect(viewport).toBeVisible()

    llm.release()

    // While following the live edge, stream growth should stay near the bottom.
    await expect
      .poll(
        async () => {
          return viewport.evaluate((el) => {
            const max = el.scrollHeight - el.clientHeight
            if (max < 80) return null
            return el.scrollTop >= max - 40
          })
        },
        { timeout: 30_000 }
      )
      .toBe(true)

    await expectAssistantText(page, "SCROLL_MARKER_END", { timeout: 30_000 })

    // Seed enough height that scrolling up is meaningful.
    llm.enqueue({
      text:
        "SECOND " +
        Array.from({ length: 60 }, (_, i) => `more-line-${i}`).join(" "),
      hold: true,
    })
    await sendMessage(page, "another tall turn")
    await expect(streamingMarkers(page)).toHaveCount(1, { timeout: 15_000 })

    // Release live-edge follow with a real user wheel (scrollTop alone does not).
    await viewport.dispatchEvent("wheel", { deltaY: -400 })
    await viewport.evaluate((el) => {
      el.scrollTop = 0
    })
    const topAfterScrollAway = await viewport.evaluate((el) => el.scrollTop)
    expect(topAfterScrollAway).toBeLessThan(40)

    llm.release()

    // Hold position while tokens continue (no yank back to bottom).
    // Stream growth can shift max slightly; stay near the top, not live edge.
    await page.waitForTimeout(200)
    const duringStream = await viewport.evaluate((el) => el.scrollTop)
    const maxDuring = await viewport.evaluate(
      (el) => el.scrollHeight - el.clientHeight
    )
    expect(duringStream).toBeLessThan(Math.max(80, maxDuring * 0.25))

    await expectAssistantText(page, /more-line-50/, { timeout: 30_000 })

    // Jump-to-end re-engages the live edge.
    const jump = page.getByTestId("chat-scroll-to-end")
    await expect(jump).toHaveAttribute("data-active", "true", {
      timeout: 10_000,
    })
    await jump.click()

    await expect
      .poll(async () => {
        return viewport.evaluate((el) => {
          const max = el.scrollHeight - el.clientHeight
          return el.scrollTop >= max - 40
        })
      })
      .toBe(true)
  })

  test("edit-as-branch keeps the edited slot in view", async () => {
    await openNewChat(page)

    const filler = (tag: string) =>
      `${tag} ` +
      Array.from({ length: 50 }, (_, i) => `${tag}-line-${i}`).join(" ")

    for (const [prompt, tag] of [
      ["first tall turn", "TURN_A"],
      ["second tall turn", "TURN_B"],
      ["third tall turn", "TURN_C"],
    ] as const) {
      llm.enqueue({ text: filler(tag) })
      await sendMessage(page, prompt)
      await expectAssistantText(page, `${tag}-line-49`, { timeout: 30_000 })
    }

    const viewport = page.getByTestId("chat-transcript-viewport")
    await expect(viewport).toBeVisible()

    const lastUser = page
      .locator("article")
      .filter({ has: page.getByText("user", { exact: true }) })
      .last()

    await viewport.dispatchEvent("wheel", { deltaY: -400 })
    await lastUser.evaluate((el) => {
      el.scrollIntoView({ block: "center", inline: "nearest" })
    })

    const scrollBefore = await viewport.evaluate((el) => el.scrollTop)
    expect(scrollBefore).toBeGreaterThan(80)

    llm.enqueue({
      text:
        "EDIT_REPLY " +
        Array.from({ length: 20 }, (_, i) => `edit-line-${i}`).join(" "),
    })
    await editUserAsBranch(page, "edited third question")
    await expectUserMessage(page, "edited third question")

    const edited = page
      .locator('[data-slot-layer="present"]')
      .filter({ has: page.getByText("user", { exact: true }) })
      .filter({ hasText: "edited third question" })
    await expect(edited).toBeVisible()

    const editedInView = await edited.evaluate((el) => {
      const viewport = document.querySelector(
        "[data-testid=chat-transcript-viewport]"
      )
      if (!viewport) return false
      const v = viewport.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return r.bottom > v.top && r.top < v.bottom
    })
    expect(editedInView).toBe(true)

    const scrollAfter = await viewport.evaluate((el) => el.scrollTop)
    expect(scrollAfter).toBeGreaterThan(80)
  })
})
