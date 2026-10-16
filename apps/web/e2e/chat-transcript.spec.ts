import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Locator,
} from "@playwright/test"
import { TRANSCRIPT_LIVE_EDGE_PX } from "../components/workspace/transcript-viewport-model"
import { startMockLlm, type MockLlm } from "./helpers/mock-llm"
import {
  editUserAsBranch,
  ensureMockProvider,
  ensureWorkspace,
  expectAssistantText,
  expectUserMessage,
  openNewChat,
  presentArticles,
  sendMessage,
  streamingMarkers,
} from "./helpers/workspace"

type SeededMessage = { id: string }

async function mutate<T>(
  page: Page,
  procedure: string,
  data: unknown
): Promise<T> {
  const response = await page.request.post(`/api/trpc/workspace.${procedure}`, {
    data,
  })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).result.data as T
}

async function settledTranscriptOffset(port: Locator) {
  return port.evaluate(
    (el) =>
      new Promise<number>((resolve) => {
        let previous = el.scrollTop
        let stableFrames = 0
        const frame = () => {
          stableFrames =
            Math.abs(el.scrollTop - previous) < 1 ? stableFrames + 1 : 0
          previous = el.scrollTop
          if (stableFrames >= 4) resolve(previous)
          else requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      })
  )
}

async function wheelTranscript(page: Page, port: Locator, delta: number) {
  await page.bringToFront()
  await port.hover()
  const before = await port.evaluate((el) => el.scrollTop)
  await page.mouse.wheel(0, delta)
  await expect
    .poll(() =>
      port.evaluate((el, old) => Math.abs(el.scrollTop - old), before)
    )
    .toBeGreaterThan(1)
  return settledTranscriptOffset(port)
}

async function seedVersions(page: Page, prefixCount = 4, descendants = 4) {
  const chat = await mutate<{ id: string }>(page, "createChat", {
    title: "Viewport fixture",
  })
  const add = (
    parentId: string | null,
    role: "user" | "assistant",
    text: string
  ) =>
    mutate<SeededMessage>(page, "createMessage", {
      chatId: chat.id,
      parentId,
      role,
      parts: [{ type: "text", text }],
      attachSelection: true,
    })
  let previous: string | null = null
  for (let index = 0; index < prefixCount; index++) {
    previous = (
      await add(
        previous,
        index % 2 ? "assistant" : "user",
        `PREFIX_${index}\n\n` + "Earlier content.\n\n".repeat(8)
      )
    ).id
  }
  const parent = await add(previous, "user", "Compare these versions")
  const first = await add(
    parent.id,
    "assistant",
    "VERSION_A\n\n" + "First version content.\n\n".repeat(12)
  )
  let tip = first.id
  for (let index = 0; index < descendants; index++)
    tip = (
      await add(
        tip,
        index % 2 ? "assistant" : "user",
        `AFTER_A_${index}\n\n` + "Content after the version.\n\n".repeat(8)
      )
    ).id
  const second = await add(
    parent.id,
    "assistant",
    "VERSION_B\n\n" + "Second version content.\n\n".repeat(18)
  )
  tip = second.id
  for (let index = 0; index < descendants; index++)
    tip = (
      await add(
        tip,
        index % 2 ? "assistant" : "user",
        `AFTER_B_${index}\n\n` + "Content after the version.\n\n".repeat(8)
      )
    ).id
  await mutate(page, "selectChild", { nodeId: parent.id, childId: first.id })
  await page.goto(`/chat/${chat.id}`)
  const port = page.getByTestId("chat-transcript-viewport")
  const row = port.locator(`[data-index="${prefixCount + 1}"]`)
  await expect(row.getByText("VERSION_A", { exact: true })).toBeAttached()
  return { chat, port, row }
}

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

    // Use the browser's wheel scrolling, including its asynchronous first frame.
    await wheelTranscript(page, viewport, -500)
    await expect
      .poll(() =>
        viewport.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop
        )
      )
      .toBeGreaterThan(200)
    const topAfterScrollAway = await viewport.evaluate((el) => el.scrollTop)

    llm.release()

    // Hold position while tokens continue (no yank back to bottom).
    // Stream growth can shift max slightly; stay near the top, not live edge.
    await page.waitForTimeout(200)
    const duringStream = await viewport.evaluate((el) => el.scrollTop)
    expect(duringStream).toBeCloseTo(topAfterScrollAway, 0)

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

  test("small upward gestures release following inside the live-edge threshold", async () => {
    for (const input of ["wheel", "ArrowUp"]) {
      const { port } = await seedVersions(page)
      const gap = () =>
        port.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
      await expect.poll(gap).toBeLessThan(2)
      if (input === "wheel") await port.hover()
      else await port.focus()
      if (input === "wheel") await page.mouse.wheel(0, -12)
      else await page.keyboard.press("ArrowUp")
      await expect.poll(gap, { message: input }).toBeGreaterThan(4)
      await settledTranscriptOffset(port)
      await expect.poll(gap, { message: input }).toBeGreaterThan(4)
      expect(await gap()).toBeLessThan(TRANSCRIPT_LIVE_EDGE_PX)
      const parked = await port.evaluate((el) => el.scrollTop)
      await port
        .locator('[data-slot-layer="present"]')
        .last()
        .evaluate((el) => {
          ;(el as HTMLElement).style.minHeight =
            `${el.getBoundingClientRect().height + 200}px`
        })
      await expect.poll(gap).toBeGreaterThan(200)
      expect(await port.evaluate((el) => el.scrollTop)).toBeCloseTo(parked, 0)
    }
  })

  test("non-scrolling input at the live edge keeps following", async () => {
    for (const input of [
      "background click",
      "ArrowDown",
      "PageDown",
      "End",
      "touch",
    ]) {
      const { port } = await seedVersions(page)
      const gap = () =>
        port.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
      await expect.poll(gap).toBeLessThan(2)
      if (input === "background click") {
        // The space beside the centered message column belongs to the port.
        await port.click({ position: { x: 2, y: 30 } })
      } else if (input === "touch") {
        await port.dispatchEvent("touchmove")
      } else {
        await port.focus()
        await page.keyboard.press(input)
      }
      const last = port.locator('[data-slot-layer="present"]').last()
      await last.evaluate((el) => {
        ;(el as HTMLElement).style.minHeight =
          `${el.getBoundingClientRect().height + 200}px`
      })
      await expect.poll(gap, { message: input }).toBeLessThan(2)
    }
  })

  test("nested wheel scrolling leaves outer following enabled", async () => {
    const { port } = await seedVersions(page)
    const last = port.locator('[data-slot-layer="present"]').last()
    await last.evaluate((el) => {
      const nested = document.createElement("div")
      nested.dataset.testid = "nested-scroll-fixture"
      nested.style.cssText =
        "position:relative;z-index:50;height:100px;overflow-y:auto;overscroll-behavior:contain"
      const content = document.createElement("div")
      content.style.height = "600px"
      nested.append(content)
      el.append(nested)
      nested.scrollTop = 200
    })
    const gap = () =>
      port.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
    await expect.poll(gap).toBeLessThan(2)
    const nested = port.getByTestId("nested-scroll-fixture")
    await expect.poll(() => nested.evaluate((el) => el.scrollTop)).toBe(200)
    await nested.hover()
    await page.mouse.wheel(0, -40)
    await expect
      .poll(() => nested.evaluate((el) => el.scrollTop))
      .toBeLessThan(190)
    await last.evaluate((el) => {
      ;(el as HTMLElement).style.minHeight =
        `${el.getBoundingClientRect().height + 200}px`
    })
    await expect.poll(gap).toBeLessThan(2)
  })

  test("resizing preserves the reading point and following remains explicit", async () => {
    const original = page.viewportSize()!
    try {
      const { port } = await seedVersions(page)
      await expect
        .poll(() => port.evaluate((el) => el.scrollHeight - el.clientHeight))
        .toBeGreaterThan(500)
      await expect
        .poll(() =>
          port.evaluate(
            (el) => el.scrollHeight - el.clientHeight - el.scrollTop
          )
        )
        .toBeLessThan(2)
      await wheelTranscript(page, port, -500)
      const anchor = await port.evaluate((el) => {
        const top = el.getBoundingClientRect().top
        const row = [
          ...el.querySelectorAll<HTMLElement>(
            ":scope > [role=list] > [data-index]"
          ),
        ].find((row) => row.getBoundingClientRect().bottom > top)!
        return {
          index: row.dataset.index!,
          y: row.getBoundingClientRect().top - top,
        }
      })
      const row = port.locator(`[data-index="${anchor.index}"]`)
      await page.setViewportSize({ width: 1000, height: 650 })
      await expect
        .poll(() =>
          row.evaluate(
            (el) =>
              el.getBoundingClientRect().top -
              el.closest("[data-transcript-viewport]")!.getBoundingClientRect()
                .top
          )
        )
        .toBeCloseTo(anchor.y, 0)
      await page.getByTestId("chat-scroll-to-end").click()
      await page.setViewportSize({ width: 1100, height: 750 })
      await expect
        .poll(() =>
          port.evaluate(
            (el) => el.scrollHeight - el.clientHeight - el.scrollTop
          )
        )
        .toBeLessThan(2)
    } finally {
      await page.setViewportSize(original)
    }
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
          'article[data-theme-target="message-assistant"]:has([data-slot-layer="present"])'
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
        const streamMarker =
          assistant?.getAttribute("data-message-status") === "streaming"
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

    const userMessages = page.locator(
      'article[data-theme-target="message-user"]'
    )
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

    const edited = presentArticles(page, "message-user").filter({
      hasText: "edited third question",
    })
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

  test("stops a message before its first token without a composer Stop", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "SHOULD_NOT_ARRIVE", hold: true })
    await sendMessage(page, "stop before output")
    const message = streamingMarkers(page)
    await expect(message).toHaveCount(1)
    await expect(
      page.getByRole("button", { name: "Stop", exact: true })
    ).toHaveCount(0)
    await message.getByRole("button", { name: "Stop generation" }).click()
    await expect(streamingMarkers(page)).toHaveCount(0)
    await expect(page.getByText("SHOULD_NOT_ARRIVE")).toHaveCount(0)
    llm.release()
  })

  test("edit forks an in-flight assistant as a sibling", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "LIVE_PARTIAL_REPLY", holdAfterText: true })
    await sendMessage(page, "stream then edit")
    await expect(streamingMarkers(page)).toHaveCount(1, { timeout: 15_000 })
    await expect(page.getByText("LIVE_PARTIAL_REPLY")).toBeVisible({
      timeout: 15_000,
    })

    const streaming = streamingMarkers(page)
    await streaming.getByRole("button", { name: "Edit", exact: true }).click()
    const editor = page.getByRole("textbox", { name: "Message text" })
    await expect(editor).toBeVisible()
    await editor.fill("FORKED_FROM_STREAM")
    await page.getByRole("button", { name: "Save branch" }).click()
    await expect(editor).toHaveCount(0)
    await expectAssistantText(page, "FORKED_FROM_STREAM")
    await expect(streamingMarkers(page)).toHaveCount(0)

    llm.release()
  })

  test("long-message jump rail moves between the message edges", async () => {
    await openNewChat(page)

    // Put the target row below the canvas origin; translated virtual rows used
    // to displace sticky descendants by this accumulated offset.
    llm.enqueue({ text: "RAIL_HISTORY" })
    await sendMessage(page, "earlier turn")
    await expectAssistantText(page, "RAIL_HISTORY")

    const longReply =
      "JUMP_START\n\n" +
      Array.from(
        { length: 80 },
        (_, i) =>
          `jump-line-${i} extra filler so the bubble is taller than the pane.`
      ).join("\n\n") +
      "\n\nJUMP_END"

    llm.enqueue({ text: longReply })
    await sendMessage(page, "write a tall reply")
    await expectAssistantText(page, "JUMP_END", { timeout: 30_000 })

    const article = page.locator("article").filter({ hasText: "JUMP_START" })
    await expect(article).toBeVisible()

    const scrollToMiddle = () =>
      article.evaluate((el) => {
        const port = el.closest("[data-testid=chat-transcript-viewport]")
        if (!(port instanceof HTMLElement)) return
        const portRect = port.getBoundingClientRect()
        const rect = el.getBoundingClientRect()
        port.scrollTop +=
          rect.top - portRect.top + rect.height / 2 - port.clientHeight / 2
      })
    const startOffset = () =>
      article.evaluate((el) => {
        const port = el.closest("[data-testid=chat-transcript-viewport]")
        if (!(port instanceof HTMLElement)) return Number.POSITIVE_INFINITY
        return Math.abs(
          el.getBoundingClientRect().top - port.getBoundingClientRect().top
        )
      })

    await scrollToMiddle()

    const frame = article.locator("..")
    const start = frame.getByTestId("long-block-nav-start")
    const end = frame.getByTestId("long-block-nav-end")
    await expect(start).toBeVisible()
    await expect(end).toBeVisible()

    await expect(start).toBeInViewport()
    await expect(end).toBeInViewport()
    const scrollWithoutTabShift = (delta: number) =>
      start.evaluate((el, scrollDelta) => {
        const port = el.closest(
          "[data-testid=chat-transcript-viewport]"
        ) as HTMLElement
        const before = el.getBoundingClientRect().top
        port.scrollTop += scrollDelta
        return Math.abs(el.getBoundingClientRect().top - before)
      }, delta)

    // The tile must move synchronously with scrolling. A JS follower can reach
    // the same final position but visibly lag behind compositor scrolling.
    expect(await scrollWithoutTabShift(100)).toBeLessThan(2)

    await start.click()
    await expect.poll(startOffset).toBeLessThan(8)
    await expect(start).toBeDisabled()

    await scrollToMiddle()
    await expect(end).toBeEnabled()
    await end.click()
    await expect(end).toBeDisabled()
    await expect(start).toBeEnabled()
    // Starting to scroll away from the end must not change the sticky inset
    // as the viewport fade appears.
    expect(await scrollWithoutTabShift(-60)).toBeLessThan(2)
  })

  test("version switching aligns before paint", async () => {
    const { port, row } = await seedVersions(page)
    const stepper = row.locator('[data-message-footer-html="stepper"]')
    await stepper.evaluate((el) => el.scrollIntoView({ block: "center" }))
    const offset = () =>
      stepper.evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          el
            .closest('[data-testid="chat-transcript-viewport"]')!
            .getBoundingClientRect().top
      )
    await expect
      .poll(() =>
        port.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
      )
      .toBeGreaterThan(80)
    const parked = await offset()

    // Sample the first painted replacement and all subsequent frames.
    await port.evaluate((el) => {
      const state = window as typeof window & {
        switchFrames: number[]
        sampleSwitch: boolean
      }
      state.switchFrames = []
      state.sampleSwitch = true
      const sample = () => {
        const article = el.querySelector('[data-index="5"] article')
        const present = article?.querySelector('[data-slot-layer="present"]')
        const anchor = article?.querySelector(
          '[data-message-footer-html="stepper"]'
        )
        if (present?.textContent?.includes("VERSION_B") && anchor)
          state.switchFrames.push(
            anchor.getBoundingClientRect().top - el.getBoundingClientRect().top
          )
        if (state.sampleSwitch) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await row.getByRole("button", { name: "Next branch" }).click()
    await expect(row.getByText("VERSION_B", { exact: true })).toBeVisible()
    await expect.poll(offset).toBeCloseTo(parked, 0)
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { switchFrames: number[] }).switchFrames
              .length
        )
      )
      .toBeGreaterThan(2)
    const frames = await page.evaluate(() => {
      const state = window as typeof window & {
        switchFrames: number[]
        sampleSwitch: boolean
      }
      state.sampleSwitch = false
      return state.switchFrames
    })
    expect(Math.max(...frames.map((y) => Math.abs(y - parked)))).toBeLessThan(2)
  })

  test("sending near the live edge while reading preserves position through reply growth", async () => {
    await seedVersions(page)
    const port = page.getByTestId("chat-transcript-viewport")
    await wheelTranscript(page, port, -12)
    const gap = await port.evaluate(
      (el) => el.scrollHeight - el.clientHeight - el.scrollTop
    )
    expect(gap).toBeGreaterThan(4)
    expect(gap).toBeLessThan(TRANSCRIPT_LIVE_EDGE_PX)
    const before = await port.evaluate((el) => el.scrollTop)
    llm.enqueue({
      text: "SENT_WHILE_READING\n\n" + "A growing reply.\n\n".repeat(40),
      hold: true,
    })
    await sendMessage(page, "send without leaving my reading position")
    await expect(streamingMarkers(page)).toHaveCount(1)
    expect(await port.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0)
    llm.release()
    await expectAssistantText(page, "SENT_WHILE_READING")
    await expect
      .poll(() =>
        port.evaluate(
          (el, expected) => Math.abs(el.scrollTop - expected),
          before
        )
      )
      .toBeLessThan(2)
  })

  test("sending from a populated draft keeps its reader through chat creation", async () => {
    const { chat } = await seedVersions(page)
    const template = await mutate<{ id: string }>(
      page,
      "saveChatTemplateFromChat",
      {
        chatId: chat.id,
        name: "Reading position template",
      }
    )
    await page.goto(`/chat/new?template=${template.id}`)
    const port = page.getByTestId("chat-transcript-viewport")
    await expect(port.getByText("VERSION_A", { exact: true })).toBeAttached()
    await wheelTranscript(page, port, -12)
    const gap = await port.evaluate(
      (el) => el.scrollHeight - el.clientHeight - el.scrollTop
    )
    expect(gap).toBeGreaterThan(4)
    expect(gap).toBeLessThan(TRANSCRIPT_LIVE_EDGE_PX)
    const before = await port.evaluate((el) => el.scrollTop)
    llm.enqueue({ text: "DRAFT_READER_PRESERVED", hold: true })
    await sendMessage(page, "save this draft without moving my reader")
    await expect(streamingMarkers(page)).toHaveCount(1)
    await expect
      .poll(() =>
        port.evaluate(
          (el, expected) => Math.abs(el.scrollTop - expected),
          before
        )
      )
      .toBeLessThan(2)
    llm.release()
    await expectAssistantText(page, "DRAFT_READER_PRESERVED")
    await expect
      .poll(() =>
        port.evaluate(
          (el, expected) => Math.abs(el.scrollTop - expected),
          before
        )
      )
      .toBeLessThan(2)
  })

  test("find reveals an editor match through local and transcript scrollports", async () => {
    const { row, port } = await seedVersions(page)
    await row.getByRole("button", { name: "Edit", exact: true }).click()
    const editor = row.getByRole("textbox", { name: "Message text" })
    await editor.fill(
      "EDITOR_FIRST\n\n" +
        "Inside the editable document.\n\n".repeat(60) +
        "EDITOR_LAST"
    )
    await page.keyboard.press("ControlOrMeta+F")
    const find = page.getByTestId("conversation-find")
    await find.getByLabel("Find in conversation").fill("EDITOR_FIRST")
    await find.getByLabel("Find in conversation").press("Enter")
    const current = row.locator(".cm-find-current")
    await expect(current).toHaveText("EDITOR_FIRST")
    await expect
      .poll(() =>
        current.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          const port = el
            .closest('[data-testid="chat-transcript-viewport"]')!
            .getBoundingClientRect()
          const local = el
            .closest("[data-composer-field]")!
            .getBoundingClientRect()
          return Math.max(
            Math.max(port.top, local.top) - rect.top,
            rect.bottom - Math.min(port.bottom, local.bottom),
            0
          )
        })
      )
      .toBeLessThan(2)
    await find.getByLabel("Find in conversation").fill("EDITOR_LAST")
    await find.getByLabel("Find in conversation").press("Enter")
    await expect(current).toHaveText("EDITOR_LAST")
    await expect
      .poll(() =>
        current.evaluate((el) => {
          const rect = el.getBoundingClientRect()
          const port = el
            .closest('[data-testid="chat-transcript-viewport"]')!
            .getBoundingClientRect()
          const local = el
            .closest("[data-composer-field]")!
            .getBoundingClientRect()
          return Math.max(
            Math.max(port.top, local.top) - rect.top,
            rect.bottom - Math.min(port.bottom, local.bottom),
            0
          )
        })
      )
      .toBeLessThan(2)
    await expect(port).toBeVisible()
  })

  test("find and version switching resolve unmounted rows in a long transcript", async () => {
    test.setTimeout(90_000)
    const chat = await mutate<{ id: string }>(page, "createChat", {
      title: "Long viewport fixture",
    })
    const ids: string[] = []
    let parentId: string | null = null
    for (let index = 0; index < 46; index++) {
      const node: SeededMessage = await mutate(page, "createMessage", {
        chatId: chat.id,
        parentId,
        role: index % 2 ? "assistant" : "user",
        parts: [
          {
            type: "text",
            text:
              `LONG_ROW_${index}_TOKEN\n\n` +
              "Measured row content.\n\n".repeat(5),
          },
        ],
        attachSelection: true,
      })
      ids.push(node.id)
      parentId = node.id
    }
    await mutate<SeededMessage>(page, "createMessage", {
      chatId: chat.id,
      parentId: ids[20],
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "LONG_ALTERNATE\n\n" + "Alternate content.\n\n".repeat(8),
        },
      ],
      attachSelection: false,
    })
    await page.goto(`/chat/${chat.id}`)
    const port = page.getByTestId("chat-transcript-viewport")
    await expect(port.getByText("LONG_ROW_45_TOKEN")).toBeVisible()
    await expect(port.locator('[data-index="0"]')).toHaveCount(0)
    await page.keyboard.press("ControlOrMeta+F")
    const find = page.getByTestId("conversation-find")
    await find.getByLabel("Find in conversation").fill("LONG_ROW_21_TOKEN")
    await find.getByLabel("Find in conversation").press("Enter")
    const row = port.locator('[data-index="21"]')
    await expect(
      row.getByText("LONG_ROW_21_TOKEN", { exact: true })
    ).toBeVisible()
    await page.keyboard.press("Escape")
    const stepper = row.locator('[data-message-footer-html="stepper"]')
    await stepper.evaluate((el) => el.scrollIntoView({ block: "center" }))
    await row.getByRole("button", { name: "Next branch" }).click()
    await expect(row.getByText("LONG_ALTERNATE", { exact: true })).toBeVisible()
    await row.getByRole("button", { name: "Previous branch" }).click()
    await expect(
      row.getByText("LONG_ROW_21_TOKEN", { exact: true })
    ).toBeVisible()
    await page.getByTestId("chat-scroll-to-end").click()
    await expect(port.getByText("LONG_ROW_45_TOKEN")).toBeVisible()
  })
})
