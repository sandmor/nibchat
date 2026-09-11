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

  test("toggles Recents/Spaces, locks settings, and reparents on delete", async () => {
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
    await page.getByRole("button", { name: "Apply Temperature to chats" }).click()

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

    await page.getByRole("link", { name: spaceName, exact: true }).click()
    await expect(page).toHaveURL(/\/space\//)
    await page
      .getByRole("button", { name: "Stop applying Temperature" })
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
    await page.getByRole("button", { name: "New chat", exact: true }).click()
    llm.enqueue({ text: "CHILD_CHAT_REPLY" })
    await sendMessage(page, "child space chat")
    await expectAssistantText(page, "CHILD_CHAT_REPLY")
    await expect(page).toHaveURL(/\/chat\/(?!new)/)

    await page.getByRole("button", { name: "Spaces", exact: true }).click()
    await page.getByRole("button", { name: "New space actions" }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await expect(page.getByText("Chats and nested spaces move")).toBeVisible()
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(page.getByText("Space deleted")).toBeVisible({
      timeout: 10_000,
    })
    await expect(page).toHaveURL(/\/chat\/(?!new)/)

    await page.getByRole("button", { name: "Recents", exact: true }).click()
    await expect(
      page
        .getByRole("link", { name: /New conversation|child space chat/i })
        .first()
    ).toBeVisible()
  })
})
