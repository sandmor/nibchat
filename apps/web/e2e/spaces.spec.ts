import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { startMockLlm, type MockLlm } from "./helpers/mock-llm"
import {
  ensureMockProvider,
  ensureWorkspace,
  expectAssistantText,
  openChatParameters,
  sendMessage,
} from "./helpers/workspace"

test.describe.configure({ mode: "serial" })

test.describe("spaces", () => {
  let context: BrowserContext
  let page: Page
  let llm: MockLlm
  const spaceName = `E2E Space ${Date.now()}`

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

  test("toggles Recents/Spaces, locks settings, and deletes nested chats", async () => {
    await page.goto("/chat/new")
    await expect(page.getByRole("button", { name: "Recents" })).toBeVisible()
    await page.getByRole("button", { name: "Spaces", exact: true }).click()
    await page.getByRole("button", { name: "New space" }).click()
    await expect(page).toHaveURL(/\/space\//, { timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Defaults" })).toBeVisible()

    const nameField = page.getByLabel("Space name")
    await nameField.fill(spaceName)
    await nameField.blur()
    await expect(nameField).toHaveValue(spaceName)

    await page.getByRole("button", { name: "Add", exact: true }).click()
    await page.getByRole("menuitem", { name: "Temperature" }).click()
    const temperature = page.getByRole("spinbutton", { name: "Temperature" })
    await expect(temperature).toBeVisible()
    await temperature.fill("0.15")
    await temperature.blur()
    await page
      .getByRole("group", { name: "Temperature policy" })
      .getByRole("button", { name: "Require" })
      .click()

    await page.getByRole("button", { name: "Add rule" }).click()
    await page.getByLabel("New rule content").fill("PARENT_BRANCH_RULE")
    await page.getByLabel("Rule title").fill("Tone")
    await page.getByLabel("Rule title").blur()

    await page.getByRole("button", { name: "New chat", exact: true }).click()
    await expect(page).toHaveURL(/\/chat\/new\?space=/, { timeout: 15_000 })
    await expect(
      page.getByRole("button", { name: `Space: ${spaceName}` })
    ).toBeVisible()
    await openChatParameters(page)
    await expect(
      page.getByRole("spinbutton", { name: "Temperature" })
    ).toBeDisabled()
    await expect(page.getByText(`From ${spaceName}`)).toBeVisible()
    await page.keyboard.press("Escape")

    llm.enqueue({ text: "SPACE_TEMP_REPLY" })
    await sendMessage(page, "use the space temperature")
    await expectAssistantText(page, "SPACE_TEMP_REPLY")
    const streamed = llm
      .requestBodies()
      .filter((body) => body.stream === true)
      .at(-1)
    expect(streamed?.temperature).toBe(0.15)
    expect(JSON.stringify(streamed)).toContain("PARENT_BRANCH_RULE")

    await page.getByRole("link", { name: spaceName, exact: true }).click()
    await expect(page).toHaveURL(/\/space\//)
    await page
      .getByRole("group", { name: "Temperature policy" })
      .getByRole("button", { name: "Release" })
      .click()

    await page.getByRole("button", { name: "New chat", exact: true }).click()
    await expect(page).toHaveURL(/\/chat\/new\?space=/)
    await openChatParameters(page)
    await expect(
      page.getByRole("spinbutton", { name: "Temperature" })
    ).toBeEnabled()
    await page.keyboard.press("Escape")

    await page.getByRole("link", { name: spaceName, exact: true }).click()
    await page.getByRole("button", { name: "New subspace" }).click()
    await expect(page.getByLabel("Space name")).toHaveValue("New space")
    await page.getByRole("button", { name: "Replace", exact: true }).click()
    await page.getByLabel("Tone content").fill("CHILD_BRANCH_RULE")
    await page.getByLabel("Tone content").blur()
    await page.getByRole("button", { name: "New chat", exact: true }).click()
    llm.enqueue({ text: "CHILD_CHAT_REPLY" })
    await sendMessage(page, "child space chat")
    await expectAssistantText(page, "CHILD_CHAT_REPLY")
    const childRequest = llm
      .requestBodies()
      .filter((body) => body.stream === true)
      .at(-1)
    expect(JSON.stringify(childRequest)).toContain("CHILD_BRANCH_RULE")
    expect(JSON.stringify(childRequest)).not.toContain("PARENT_BRANCH_RULE")
    await expect(page).toHaveURL(/\/chat\/(?!new)/)

    await page.getByRole("button", { name: "Spaces", exact: true }).click()
    await page.getByRole("button", { name: "New space actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await expect(
      page.getByText("This deletes the space and everything inside")
    ).toBeVisible()
    await expect(page.getByText("will be permanently deleted")).toBeVisible()
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(page.getByText("Space deleted")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page).toHaveURL(/\/chat\/new/)

    await page.getByRole("button", { name: "Recents", exact: true }).click()
    await expect(
      page.getByRole("link", { name: /child space chat/i })
    ).toHaveCount(0)
  })

  test("selects chats in a space and moves them out", async () => {
    const bulkName = `E2E Bulk ${Date.now()}`
    await page.goto("/chat/new")
    await page.getByRole("button", { name: "Spaces", exact: true }).click()
    await page.getByRole("button", { name: "New space" }).click()
    await expect(page).toHaveURL(/\/space\//, { timeout: 15_000 })
    await page.getByLabel("Space name").fill(bulkName)
    await page.getByLabel("Space name").blur()
    await expect(page.getByLabel("Space name")).toHaveValue(bulkName)

    await page.getByRole("button", { name: "New chat", exact: true }).click()
    llm.enqueue({ text: "BULK_ONE" })
    await sendMessage(page, "bulk one")
    await expectAssistantText(page, "BULK_ONE")

    await page.getByRole("link", { name: bulkName, exact: true }).click()
    await page.getByRole("button", { name: "New chat", exact: true }).click()
    llm.enqueue({ text: "BULK_TWO" })
    await sendMessage(page, "bulk two")
    await expectAssistantText(page, "BULK_TWO")

    await page.getByRole("link", { name: bulkName, exact: true }).click()
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible()
    await expect(page.getByText("2 here")).toBeVisible()
    const chatsSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Chats" }) })
    await chatsSection
      .getByRole("button", { name: "Select", exact: true })
      .click()
    const bar = page.locator('[data-testid="chat-selection-bar"]:visible')
    await expect(bar.getByText("Tap chats to select them")).toBeVisible()
    await chatsSection.getByRole("link", { name: /bulk one/i }).click()
    await chatsSection.getByRole("link", { name: /bulk two/i }).click()
    await expect(bar.getByText("2 chats")).toBeVisible()
    await bar.getByRole("button", { name: "Move to…" }).click()
    await page.getByRole("button", { name: "Ungrouped" }).click()
    await expect(page.getByText("Moved 2 chats")).toBeVisible()
    await expect(
      page.getByText("New chats from this space land here.")
    ).toBeVisible()
  })
})
