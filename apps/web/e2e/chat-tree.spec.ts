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
    await expect(tree.locator("[data-tree-streaming]")).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      tree.getByRole("button", { name: "Stop generation" })
    ).toBeVisible()
    llm.release()
    await expect(
      tree.getByRole("paragraph").filter({ hasText: "TREE_BRANCH_REPLY" })
    ).toBeVisible({
      timeout: 30_000,
    })
    await expect(handoff).toHaveCount(0)

    await page.getByRole("button", { name: "Linear" }).click()
    await expectAssistantText(page, "TREE_SEED_REPLY")
    await expect(page.getByText("TREE_BRANCH_REPLY")).toBeVisible()
  })

  test("restores its mode and zoom after a reload", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "PERSISTED_TREE_REPLY" })
    await sendMessage(page, "persist this tree view")
    await expectAssistantText(page, "PERSISTED_TREE_REPLY")

    await page.getByRole("button", { name: "Tree", exact: true }).click()
    const tree = page.getByTestId("chat-tree")
    await expect(tree).toBeVisible()
    const world = tree.locator("[data-tree-world]")
    await expect(world).toHaveAttribute("data-camera-ready", "")
    const saved = page.waitForResponse((response) => {
      if (!response.url().includes("setChatViewState") || !response.ok())
        return false
      const zoom = Number(
        (response.request().postData() ?? "").match(/"zoom"\s*:\s*([0-9.]+)/)?.[1]
      )
      return zoom > 0.9
    })
    await tree
      .getByRole("button", { name: "Zoom in" })
      .evaluate((element) => (element as HTMLButtonElement).click())
    await saved

    await page.reload()
    await expect(page.getByTestId("chat-tree")).toBeVisible()
    const restored = page
      .getByTestId("chat-tree")
      .locator("[data-tree-world]")
    await expect(restored).toHaveAttribute("data-camera-ready", "")
    const transform = await restored.evaluate(
      (element) => getComputedStyle(element).transform
    )
    const scale = Number(transform.match(/^matrix\(([^,]+)/)?.[1])
    expect(scale).toBeGreaterThan(0.9)
  })
})
