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

test.describe("chat transcript", () => {
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
    const transcriptList = viewport.locator(':scope > [role="list"]')
    await expect(transcriptList).toBeVisible()
    await expect(viewport.locator('[role="log"]')).toHaveCount(0)

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

  test("hands a completed stream to static Markdown without an intermediate frame", async () => {
    await openNewChat(page)

    const reply = `HANDOFF_START

${Array.from(
  { length: 24 },
  (_, index) =>
    `Paragraph ${index}: enough Markdown text to exercise wrapping and message measurement.`
).join("\n\n")}

| Name | Value |
| --- | ---: |
| alpha | 1 |
| beta | 2 |

\`\`\`ts startLine=12
const handoff = "stable"
console.log(handoff)
\`\`\`

HANDOFF_END`

    llm.enqueue({ text: reply, hold: true })
    await sendMessage(page, "measure the renderer handoff")
    await expect(streamingMarkers(page)).toHaveCount(1, { timeout: 15_000 })

    await page.evaluate(() => {
      const root = globalThis as typeof globalThis & {
        __handoffProbe?: {
          samples: Array<{
            at: number
            frameGap: number
            renderer: string | null
            thinking: boolean
            hasContent: boolean
            streamMarker: boolean
          }>
          stop: () => void
        }
      }
      let running = true
      let previousAt = performance.now()
      let previousSignature = ""
      const samples: Array<{
        at: number
        frameGap: number
        renderer: string | null
        thinking: boolean
        hasContent: boolean
        streamMarker: boolean
      }> = []

      const sample = (at: number) => {
        const assistants = document.querySelectorAll<HTMLElement>(
          '[data-slot-layer="present"] article[data-theme-target="message-assistant"]'
        )
        const assistant = assistants.item(assistants.length - 1)
        const renderer =
          assistant
            ?.querySelector<HTMLElement>("[data-markdown-renderer]")
            ?.getAttribute("data-markdown-renderer") ?? null
        const thinking = [
          ...document.querySelectorAll<HTMLElement>("[data-markdown-renderer]"),
        ].some(
          (element) =>
            element.getClientRects().length > 0 &&
            element.textContent?.trim() === "Thinking…"
        )
        const hasContent = Boolean(
          assistant?.textContent?.includes("HANDOFF_START")
        )
        const streamMarker = Boolean(
          assistant?.textContent?.includes("assistant · streaming")
        )
        const frameGap = at - previousAt
        previousAt = at
        const signature = `${renderer}:${thinking}:${hasContent}:${streamMarker}`
        if (signature !== previousSignature || frameGap >= 32) {
          previousSignature = signature
          samples.push({
            at,
            frameGap,
            renderer,
            thinking,
            hasContent,
            streamMarker,
          })
        }
        if (running) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      root.__handoffProbe = {
        samples,
        stop: () => {
          running = false
        },
      }
    })

    llm.release()
    const finalMarkdown = page
      .locator('[data-markdown-renderer="marked"]')
      .filter({ hasText: "HANDOFF_END" })
    await expect(finalMarkdown).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(250)

    const samples = await page.evaluate(() => {
      const root = globalThis as typeof globalThis & {
        __handoffProbe?: {
          samples: Array<{
            at: number
            frameGap: number
            renderer: string | null
            thinking: boolean
            hasContent: boolean
            streamMarker: boolean
          }>
          stop: () => void
        }
      }
      root.__handoffProbe?.stop()
      return root.__handoffProbe?.samples ?? []
    })
    const firstMarked = samples.findIndex(
      (sample) => sample.renderer === "marked"
    )
    expect(firstMarked).toBeGreaterThan(0)
    const firstContent = samples.findIndex((sample) => sample.hasContent)
    expect(firstContent).toBeGreaterThan(0)
    expect(samples.slice(firstContent).some((sample) => sample.thinking)).toBe(
      false
    )
    expect(samples[firstMarked - 1]?.renderer).toBe("streamdown")
    expect(samples[firstMarked - 1]?.streamMarker).toBe(true)
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

    const userMessages = page
      .locator("article")
      .filter({ has: page.getByText("user", { exact: true }) })
    const resizeTarget = userMessages.nth(1)
    const lastUser = userMessages.last()

    await viewport.dispatchEvent("wheel", { deltaY: -400 })
    await resizeTarget.evaluate((el) => {
      el.scrollIntoView({ block: "center", inline: "nearest" })
    })

    const distanceFromEnd = await viewport.evaluate(
      (el) => el.scrollHeight - el.clientHeight - el.scrollTop
    )
    expect(distanceFromEnd).toBeGreaterThan(80)

    const visibleAnchor = await viewport.evaluate((el) => {
      const viewportRect = el.getBoundingClientRect()
      const rows = [...el.querySelectorAll<HTMLElement>("[data-index]")]
      const anchor = rows.find((row) => {
        const rect = row.getBoundingClientRect()
        return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
      })
      if (!anchor) return null
      return {
        index: anchor.dataset.index,
        offset: anchor.getBoundingClientRect().top - viewportRect.top,
      }
    })
    expect(visibleAnchor).not.toBeNull()

    await viewport.locator(':scope > [role="list"]').evaluate((el) => {
      ;(el as HTMLElement).style.setProperty("--message-width", "30rem")
    })

    await expect
      .poll(async () => {
        if (!visibleAnchor?.index) return Number.POSITIVE_INFINITY
        const anchorRow = viewport.locator(
          `[data-index="${visibleAnchor.index}"]`
        )
        if ((await anchorRow.count()) === 0) return Number.POSITIVE_INFINITY
        return anchorRow.evaluate((row, expectedOffset) => {
          const transcriptViewport = row.closest(
            '[data-testid="chat-transcript-viewport"]'
          )
          if (!transcriptViewport) return Number.POSITIVE_INFINITY
          const actualOffset =
            row.getBoundingClientRect().top -
            transcriptViewport.getBoundingClientRect().top
          return Math.abs(actualOffset - expectedOffset)
        }, visibleAnchor.offset)
      })
      .toBeLessThan(2)

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
