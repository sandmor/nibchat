import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { startMockLlm, type MockLlm } from "./helpers/mock-llm"
import {
  ensureMockProvider,
  ensureWorkspace,
  expectAssistantText,
  openNewChat,
  sendMessage,
} from "./helpers/workspace"

test.describe.configure({ mode: "serial" })

test.describe("tree canvas", () => {
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

  test("extends the linear path when Tree adds the first child to its selected tip", async () => {
    await openNewChat(page)
    llm.enqueue(
      { text: "TREE_SEED_REPLY" },
      { text: "TREE_BRANCH_REPLY", hold: true }
    )
    await sendMessage(page, "tree seed")
    await expectAssistantText(page, "TREE_SEED_REPLY")

    await page.getByRole("button", { name: "Tree", exact: true }).click()
    const tree = page.getByTestId("chat-tree")
    await expect(tree).toBeVisible()
    await tree.getByRole("button", { name: "Add branch" }).first().click()
    await tree
      .getByPlaceholder("Take this conversation somewhere new…")
      .fill("tree branch")
    await tree.getByRole("button", { name: "Send" }).click()

    const handoff = tree.locator("[data-tree-handoff]")
    await expect(handoff).toBeVisible()

    await expect(
      tree.getByRole("paragraph").filter({ hasText: "tree branch" })
    ).toBeVisible({ timeout: 15_000 })
    await expect(tree.getByText("assistant · streaming")).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      tree.getByRole("button", { name: "Stop generation" })
    ).toBeVisible()
    llm.release()
    await expect(tree.getByText("TREE_BRANCH_REPLY")).toBeVisible({
      timeout: 30_000,
    })
    await expect(handoff).toHaveCount(0)

    await page.getByRole("button", { name: "Linear" }).click()
    await expectAssistantText(page, "TREE_SEED_REPLY")
    await expect(page.getByText("TREE_BRANCH_REPLY")).toBeVisible()
  })
})
