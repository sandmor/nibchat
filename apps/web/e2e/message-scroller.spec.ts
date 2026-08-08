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
      Array.from({ length: 80 }, (_, i) => `paragraph-${i} streaming filler line for height.`).join(
        " "
      ) +
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
    llm.enqueue(
      {
        text:
          "SECOND " +
          Array.from({ length: 60 }, (_, i) => `more-line-${i}`).join(" "),
        hold: true,
      }
    )
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
    await page.waitForTimeout(200)
    const duringStream = await viewport.evaluate((el) => el.scrollTop)
    expect(duringStream).toBeLessThan(80)

    await expectAssistantText(page, /more-line-50/, { timeout: 30_000 })

    // Jump-to-end re-engages the live edge.
    const jump = page.getByTestId("chat-scroll-to-end")
    await expect(jump).toHaveAttribute("data-active", "true", { timeout: 10_000 })
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
})
