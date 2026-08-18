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
} from "./helpers/workspace"

test.describe.configure({ mode: "serial" })

test.describe("in-conversation find", () => {
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

  test("Linear Jump to an off-path hit is gated by Switch branch?", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "FIND_PATH_REPLY" }, { text: "FIND_NEW_PATH_REPLY" })
    await sendMessage(page, "FIND_OFFPATH_UNIQUE_TOKEN")
    await expectAssistantText(page, "FIND_PATH_REPLY")

    await editUserAsBranch(page, "on path now")
    await expectUserMessage(page, "on path now")
    await expectAssistantText(page, "FIND_NEW_PATH_REPLY")

    await page.keyboard.press("ControlOrMeta+F")
    const find = page.getByTestId("conversation-find")
    await expect(find).toBeVisible()
    await find
      .getByLabel("Find in conversation")
      .fill("FIND_OFFPATH_UNIQUE_TOKEN")
    await expect(find.getByText(/on other branches/)).toBeVisible()
    await find.getByRole("button", { name: "Jump" }).click()

    const dialog = page.getByRole("alertdialog")
    await expect(dialog.getByText("Switch branch?")).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toHaveCount(0)

    await expectUserMessage(page, "on path now")
    await expectAssistantText(page, "FIND_NEW_PATH_REPLY")

    await find.getByRole("button", { name: "Jump" }).click()
    await expect(dialog.getByText("Switch branch?")).toBeVisible()
    await dialog.getByRole("button", { name: "Switch path" }).click()
    await expect(dialog).toHaveCount(0)
    await expectUserMessage(page, "FIND_OFFPATH_UNIQUE_TOKEN")
    await expect(find.getByText("1 / 1")).toBeVisible()
  })

  test("on-path match reports 1 / 1 and typing after locate keeps the path", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "FIND_COUNT_REPLY" })
    await sendMessage(page, "FIND_ONPATH_UNIQUE_TOKEN")
    await expectAssistantText(page, "FIND_COUNT_REPLY")

    await page.keyboard.press("ControlOrMeta+F")
    const find = page.getByTestId("conversation-find")
    await expect(find).toBeVisible()
    await find
      .getByLabel("Find in conversation")
      .fill("FIND_ONPATH_UNIQUE_TOKEN")
    await expect(find.getByText("1 / 1")).toBeVisible()
    await find.getByLabel("Find in conversation").press("Enter")
    await expectUserMessage(page, "FIND_ONPATH_UNIQUE_TOKEN")

    await find
      .getByLabel("Find in conversation")
      .fill("FIND_ONPATH_UNIQUE_TOKEN extra")
    await expectUserMessage(page, "FIND_ONPATH_UNIQUE_TOKEN")
    await expectAssistantText(page, "FIND_COUNT_REPLY")
  })

  test("Tree result Enter locates that message instead of the next match", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "FIND_TREE_A_REPLY" }, { text: "FIND_TREE_B_REPLY" })
    await sendMessage(page, "FIND_TREE_SHARED unique-token on A")
    await expectAssistantText(page, "FIND_TREE_A_REPLY")
    await editUserAsBranch(page, "FIND_TREE_SHARED unique-token on B")
    await expectUserMessage(page, "FIND_TREE_SHARED unique-token on B")
    await expectAssistantText(page, "FIND_TREE_B_REPLY")

    await page.getByRole("button", { name: "Tree", exact: true }).click()
    await expect(page.getByTestId("chat-tree")).toBeVisible()
    await page.keyboard.press("ControlOrMeta+F")
    const find = page.getByTestId("conversation-find")
    await find.getByLabel("Find in conversation").fill("FIND_TREE_SHARED")
    await expect(find.getByText("1 / 2")).toBeVisible()
    await find.getByRole("button", { name: /2 messages/ }).click()
    const onPath = find.getByRole("button").filter({ hasText: "On path" })
    await expect(onPath).toBeVisible()
    await onPath.focus()
    await page.keyboard.press("Enter")
    await expect(find.getByText("1 / 2")).toBeVisible()
    await expect(onPath).toHaveClass(/bg-muted/)
  })

  test("Cancel Jump does not pin the off-path hit as current", async () => {
    await openNewChat(page)
    llm.enqueue({ text: "FIND_CANCEL_A" }, { text: "FIND_CANCEL_B" })
    await sendMessage(page, "FIND_CANCEL_SHARED on A")
    await expectAssistantText(page, "FIND_CANCEL_A")
    await editUserAsBranch(page, "FIND_CANCEL_SHARED on B")
    await expectUserMessage(page, "FIND_CANCEL_SHARED on B")
    await expectAssistantText(page, "FIND_CANCEL_B")

    await page.keyboard.press("ControlOrMeta+F")
    const find = page.getByTestId("conversation-find")
    await find.getByLabel("Find in conversation").fill("FIND_CANCEL_SHARED")
    await expect(find.getByText("1 / 1")).toBeVisible()
    await expect(find.getByText(/on other branches/)).toBeVisible()
    await find.getByRole("button", { name: "Jump" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog.getByText("Switch branch?")).toBeVisible()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByRole("button", { name: "Tree", exact: true }).click()
    await expect(page.getByTestId("chat-tree")).toBeVisible()
    await expect(find.getByText("1 / 2")).toBeVisible()
    await expect(
      find.getByRole("button", { name: "Use this path" })
    ).toHaveCount(0)
  })
})
