import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { startMockLlm, type MockLlm } from "./helpers/mock-llm"
import {
  deleteActiveUserSubtree,
  editUserAsBranch,
  ensureMockProvider,
  ensureWorkspace,
  expectAssistantText,
  expectNoAssistantText,
  expectStreamingCount,
  expectUserMessage,
  openBranchNext,
  openBranchPrev,
  openChatByTitle,
  openNewChat,
  openNewChatSoft,
  regenerateAssistant,
  sendMessage,
  streamingMarkers,
} from "./helpers/workspace"

/**
 * Tree-branching + concurrent generation invariants:
 * - Soft-follow keeps alternate-branch children visible after stream ends
 * - Live streams render only on their branch path
 * - Subtree delete aborts in-flight streams under that subtree
 * - Multiple branches and chats can generate concurrently (while clients stay connected)
 */
test.describe.configure({ mode: "serial" })

test.describe("chat tree invariants", () => {
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

  test("edit-as-branch reply stays after the stream ends", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "BRANCH_A_COMPLETE" }, { text: "BRANCH_B_COMPLETE" })

    await sendMessage(page, "seed user prompt A")
    await expectAssistantText(page, "BRANCH_A_COMPLETE")

    await editUserAsBranch(page, "seed user prompt B")
    await expectAssistantText(page, "BRANCH_B_COMPLETE")

    // Soft-follow / selection: reply must remain after streaming overlay clears.
    await expect(streamingMarkers(page)).toHaveCount(0)
    await expectAssistantText(page, "BRANCH_B_COMPLETE")
    await expectUserMessage(page, "seed user prompt B")

    // Branch 1 still has its own reply.
    await openBranchPrev(page)
    await expectUserMessage(page, "seed user prompt A")
    await expectAssistantText(page, "BRANCH_A_COMPLETE")
    await expectNoAssistantText(page, "BRANCH_B_COMPLETE")

    await openBranchNext(page)
    await expectUserMessage(page, "seed user prompt B")
    await expectAssistantText(page, "BRANCH_B_COMPLETE")
    await expectNoAssistantText(page, "BRANCH_A_COMPLETE")
  })

  test("streaming is path-local; other branches do not show foreign partials", async () => {
    await openNewChat(page)
    llm.enqueue(
      { text: "PATH_LOCAL_A" },
      { text: "PATH_LOCAL_B" },
      { text: "HELD_ON_B", hold: true }
    )

    await sendMessage(page, "path local root A")
    await expectAssistantText(page, "PATH_LOCAL_A")

    await editUserAsBranch(page, "path local root B")
    await expectAssistantText(page, "PATH_LOCAL_B")

    // Start a slow follow-up generation on branch B.
    await sendMessage(page, "continue on B")
    await expect(streamingMarkers(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("assistant · streaming")).toBeVisible()

    // Switch to branch A while B is still streaming — B's stream must vanish.
    await openBranchPrev(page)
    await expectUserMessage(page, "path local root A")
    await expectAssistantText(page, "PATH_LOCAL_A")
    await expect(streamingMarkers(page)).toHaveCount(0)
    await expectNoAssistantText(page, "HELD_ON_B")

    // Back to branch B: stream reappears until released.
    await openBranchNext(page)
    await expect(streamingMarkers(page)).toBeVisible()
    llm.release()
    await expectAssistantText(page, "HELD_ON_B", { timeout: 30_000 })
    await expect(streamingMarkers(page)).toHaveCount(0)

    // Still not painted on branch A.
    await openBranchPrev(page)
    await expectNoAssistantText(page, "HELD_ON_B")
  })

  test("regenerate sibling stays after completion and is independently selectable", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "REGEN_FIRST" }, { text: "REGEN_SECOND" })

    await sendMessage(page, "regen root")
    await expectAssistantText(page, "REGEN_FIRST")

    await regenerateAssistant(page)
    await expectAssistantText(page, "REGEN_SECOND")
    await expect(streamingMarkers(page)).toHaveCount(0)

    await openBranchPrev(page)
    await expectAssistantText(page, "REGEN_FIRST")
    await openBranchNext(page)
    await expectAssistantText(page, "REGEN_SECOND")
  })

  test("delete subtree cancels an in-flight generation under it", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "DELETE_ME_PARENT" }, { text: "NEVER_SEEN", hold: true })

    await sendMessage(page, "to be deleted")
    await expectAssistantText(page, "DELETE_ME_PARENT")

    // Follow-up under the tip → held assistant stream (StreamingBubble has no Delete).
    await sendMessage(page, "spawn held child")
    await expect(streamingMarkers(page)).toBeVisible({ timeout: 15_000 })

    // Delete the continue-user that parents the held stream — cancels descendant streams.
    await deleteActiveUserSubtree(page)
    await expect(streamingMarkers(page)).toHaveCount(0, { timeout: 15_000 })
    llm.release()

    await expectNoAssistantText(page, "NEVER_SEEN")
    // Earlier turn remains; only the streaming subtree was removed.
    await expectAssistantText(page, "DELETE_ME_PARENT")
  })

  test("same chat: held streams on two branches stay path-local", async () => {
    await openNewChat(page)
    llm.enqueue(
      { text: "CONCURRENT_SEED_A" },
      { text: "BRANCH_B_HELD", hold: true },
      { text: "BRANCH_A_HELD", hold: true }
    )

    await sendMessage(page, "concurrent branch root A")
    await expectAssistantText(page, "CONCURRENT_SEED_A")

    await editUserAsBranch(page, "concurrent branch root B")
    await expect(streamingMarkers(page)).toBeVisible({ timeout: 15_000 })

    await openBranchPrev(page)
    await expectUserMessage(page, "concurrent branch root A")
    await expectAssistantText(page, "CONCURRENT_SEED_A")
    await expectStreamingCount(page, 0)

    await regenerateAssistant(page)
    await expect(streamingMarkers(page)).toBeVisible({ timeout: 15_000 })
    await expectStreamingCount(page, 1)
    await expectNoAssistantText(page, "BRANCH_B_HELD")

    await openBranchNext(page)
    await expectUserMessage(page, "concurrent branch root B")
    await expect(streamingMarkers(page)).toBeVisible()
    await expectNoAssistantText(page, "BRANCH_A_HELD")

    llm.release()
    llm.release()

    await expectAssistantText(page, "BRANCH_B_HELD", { timeout: 30_000 })
    await expectStreamingCount(page, 0)

    await openBranchPrev(page)
    await expectAssistantText(page, "BRANCH_A_HELD", { timeout: 30_000 })
    await expectNoAssistantText(page, "BRANCH_B_HELD")

    await openBranchNext(page)
    await expectAssistantText(page, "BRANCH_B_HELD")
    await expectNoAssistantText(page, "BRANCH_A_HELD")
  })

  test("multiple chats: client-side nav does not cancel background streams", async () => {
    // Soft Link navigation only — page.goto would cancel the fetch.
    const before = llm.requestCount()

    await openNewChatSoft(page)
    llm.enqueue(
      { text: "ALPHA_SEED_OK" },
      { text: "ALPHA_HELD_REPLY", hold: true }
    )
    await sendMessage(page, "alpha seed")
    await expectAssistantText(page, "ALPHA_SEED_OK")
    await sendMessage(page, "alpha held")
    await expect(streamingMarkers(page)).toBeVisible({ timeout: 15_000 })

    await openNewChatSoft(page)
    llm.enqueue(
      { text: "BETA_SEED_OK" },
      { text: "BETA_HELD_REPLY", hold: true }
    )
    await sendMessage(page, "beta seed")
    await expectAssistantText(page, "BETA_SEED_OK")
    await sendMessage(page, "beta held")
    await expect(streamingMarkers(page)).toBeVisible({ timeout: 15_000 })

    expect(llm.requestCount() - before).toBe(4)

    // Alpha stream must still be alive after SPA switch away and back.
    await openChatByTitle(page, "alpha seed")
    await expect(streamingMarkers(page)).toBeVisible({ timeout: 15_000 })
    await expectNoAssistantText(page, "BETA_HELD_REPLY")

    await openChatByTitle(page, "beta seed")
    await expect(streamingMarkers(page)).toBeVisible({ timeout: 15_000 })
    await expectNoAssistantText(page, "ALPHA_HELD_REPLY")

    llm.release()
    llm.release()

    await expectAssistantText(page, "BETA_HELD_REPLY", { timeout: 30_000 })
    await expectStreamingCount(page, 0)
    await expectNoAssistantText(page, "ALPHA_HELD_REPLY")

    await openChatByTitle(page, "alpha seed")
    await expectAssistantText(page, "ALPHA_HELD_REPLY", { timeout: 30_000 })
    await expectNoAssistantText(page, "BETA_HELD_REPLY")
  })
})
