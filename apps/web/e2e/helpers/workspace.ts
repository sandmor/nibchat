import { expect, type Page } from "@playwright/test"

const OWNER = {
  name: "Owner",
  email: "owner@example.com",
  password: "password12345",
}

/**
 * Land on the workspace whether the instance needs first-time claim or login.
 * Shares credentials with owner-flow so suites can share one e2e database.
 */
export async function ensureWorkspace(page: Page) {
  await page.goto("/")
  await page.waitForURL(/\/(setup|login|chat)/, { timeout: 30_000 })

  if (page.url().includes("/setup")) {
    const name = page.getByLabel("Name", { exact: true })
    if (await name.isVisible().catch(() => false)) {
      await name.fill(OWNER.name)
      await page.getByLabel("Email").fill(OWNER.email)
      await page.getByLabel("Password").fill(OWNER.password)
      await page.getByRole("button", { name: "Create owner account" }).click()
    }
    const skip = page.getByRole("button", { name: "Skip for now" })
    await expect(skip).toBeVisible({ timeout: 30_000 })
    await skip.click()
  } else if (page.url().includes("/login")) {
    await page.getByLabel("Email").fill(OWNER.email)
    await page.getByLabel("Password").fill(OWNER.password)
    await page.getByRole("button", { name: "Sign in" }).click()
  }

  await expect(page).toHaveURL(/\/chat\//, { timeout: 30_000 })
}

/** Register an OpenAI-compatible provider (or refresh its base URL) for the mock LLM. */
export async function ensureMockProvider(page: Page, baseUrl: string) {
  // Each suite boots its own mock LLM on a fresh port and closes it in afterAll.
  // Point (or re-point) the shared "E2E Mock" profile at that live base URL via
  // the settings UI so we stay on the same mutation path as a real user.
  await ensureMockProviderViaSettingsUi(page, baseUrl)
}

export async function openSettingsTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click()
}

async function ensureMockProviderViaSettingsUi(page: Page, baseUrl: string) {
  await page.goto("/settings")
  await openSettingsTab(page, "Connections")
  const providersCard = page.locator("#providers")
  await expect(providersCard.getByText("Model providers")).toBeVisible({
    timeout: 15_000,
  })

  const editInMockRow = providersCard
    .locator("div.flex.flex-wrap")
    .filter({ hasText: "E2E Mock" })
    .getByRole("button", { name: "Edit", exact: true })
  const providerEditButtons = providersCard.getByRole("button", {
    name: "Edit",
    exact: true,
  })

  if ((await editInMockRow.count()) > 0) {
    await editInMockRow.first().click()
  } else if ((await providerEditButtons.count()) > 0) {
    // owner-flow creates the first provider, which new chats inherit. Reuse
    // that profile so a later page load cannot fall back to its placeholder key.
    await providerEditButtons.first().click()
    await page.getByLabel("Display name").fill("E2E Mock")
    await page.getByLabel("Kind").click()
    await page
      .getByRole("option", { name: "OpenAI-compatible", exact: true })
      .click()
  } else {
    await page.getByLabel("Display name").fill("E2E Mock")
  }

  await page.getByLabel("Base URL").fill(baseUrl)
  const headerName = page.getByRole("textbox", {
    name: "Request headers name 1",
  })
  const headerValue = page.getByRole("textbox", {
    name: "Request headers value 1",
  })
  if ((await headerName.count()) === 0) {
    await page.getByRole("button", { name: "Add header" }).click()
  }
  await headerName.fill("Authorization")
  await headerValue.fill("Bearer sk-e2e-test-key")
  const disableAll = page.getByRole("button", {
    name: "Disable all",
    exact: true,
  })
  if (await disableAll.isEnabled()) await disableAll.click()
  await page.getByLabel("Add model ID").fill("e2e-model")
  await page.getByRole("button", { name: "Add model" }).click()
  await expect(
    page.getByRole("switch", { name: "Show e2e-model in chats" })
  ).toBeChecked()

  await page
    .getByRole("button", { name: /^(Save provider|Update provider)$/ })
    .click()
  await expect(page.getByText("Provider saved", { exact: false }))
    .toBeVisible({
      timeout: 15_000,
    })
    .catch(async () => {
      // Toast may already dismiss; accept a listed profile instead.
      await expect(page.getByText("E2E Mock", { exact: true })).toBeVisible()
    })

  await page.goto("/chat/new")
  await expect(page.getByText("Write anything to begin")).toBeVisible({
    timeout: 15_000,
  })
}

/**
 * Full document load into a draft chat. Fine for suite setup; does cancel
 * in-flight fetches. Prefer {@link openNewChatSoft} when streams must survive.
 */
export async function openNewChat(page: Page) {
  await page.goto("/chat/new")
  await expect(page.getByText("Write anything to begin")).toBeVisible({
    timeout: 15_000,
  })
}

/** Soft navigation to /chat/new via the shell Link (streams keep running). */
export async function openNewChatSoft(page: Page) {
  await page.getByRole("link", { name: "New conversation" }).first().click()
  await expect(page).toHaveURL(/\/chat\/new/, { timeout: 15_000 })
  await expect(page.getByText("Write anything to begin")).toBeVisible({
    timeout: 15_000,
  })
}

/** Soft navigation via sidebar title (auto-title from first user message). */
export async function openChatByTitle(page: Page, title: string) {
  await page
    .getByRole("link", { name: new RegExp(title) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/chat\//, { timeout: 15_000 })
  await expect(page.getByRole("heading", { name: title })).toBeVisible({
    timeout: 15_000,
  })
}

export async function openChatHeaderMore(page: Page) {
  await page.locator("header").getByRole("button", { name: "More" }).click()
}

export async function openChatParameters(page: Page) {
  await openChatHeaderMore(page)
  await page
    .getByRole("menuitem", { name: "Chat settings", exact: true })
    .click()
}

export async function openChatReasoning(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click()
}

export async function sendMessage(page: Page, content: string) {
  const creatingChat = new URL(page.url()).pathname === "/chat/new"
  const composer = page.getByPlaceholder("Message Nibchat…")
  await composer.fill(content)
  await page.getByRole("button", { name: "Send", exact: true }).click()
  // The first send hands the draft route to the new chat. Later interactions
  // belong to that route, whose mount resets transient UI such as find.
  if (creatingChat)
    await expect(page).not.toHaveURL(/\/chat\/new(?:[?#]|$)/, {
      timeout: 30_000,
    })
}

export function presentArticles(
  page: Page,
  target: "message-user" | "message-assistant"
) {
  return page.locator(
    `article[data-theme-target="${target}"]:has([data-slot-layer="present"])`
  )
}

export async function expectAssistantText(
  page: Page,
  text: string | RegExp,
  options?: { timeout?: number }
) {
  await expect(
    page
      .locator('[data-slot-layer="present"]')
      .filter({ hasText: text })
      .first()
  ).toBeVisible({
    timeout: options?.timeout ?? 30_000,
  })
}

export async function expectNoAssistantText(page: Page, text: string | RegExp) {
  await expect(
    page.locator('[data-slot-layer="present"]').filter({ hasText: text })
  ).toHaveCount(0)
}

export async function expectUserMessage(page: Page, text: string) {
  await expect(
    presentArticles(page, "message-user").filter({ hasText: text })
  ).toBeVisible()
}

export async function openBranchNext(page: Page) {
  const button = presentArticles(page, "message-user")
    .or(presentArticles(page, "message-assistant"))
    .getByRole("button", { name: "Next branch", disabled: false })
  await expect(button).toBeEnabled()
  await button.click()
}

export async function openBranchPrev(page: Page) {
  const button = presentArticles(page, "message-user")
    .or(presentArticles(page, "message-assistant"))
    .getByRole("button", { name: "Previous branch", disabled: false })
  await expect(button).toBeEnabled()
  await button.click()
}

export async function editUserAsBranch(page: Page, nextText: string) {
  // User bubble is the right-aligned article; open edit from the active path tip user.
  const article = presentArticles(page, "message-user").last()
  await article.getByRole("button", { name: "Edit", exact: true }).click()
  const composer = page.getByRole("textbox", { name: "Message text" })
  await expect(composer).toBeVisible()
  await composer.fill(nextText)
  await page.getByRole("button", { name: "Save & generate" }).click()
}

export async function generateFromUserMessage(page: Page) {
  const user = presentArticles(page, "message-user")
  await user.last().getByRole("button", { name: "Another answer" }).click()
}

export async function deleteActiveUserSubtree(page: Page) {
  const user = presentArticles(page, "message-user")
  await user.last().getByRole("button", { name: "Delete" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByText("Delete message node")).toBeVisible()
  await dialog.getByRole("button", { name: "Delete subtree" }).click()
}

export async function deleteActiveAssistantSubtree(page: Page) {
  const assistant = presentArticles(page, "message-assistant")
  await assistant.last().getByRole("button", { name: "Delete" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByText("Delete message node")).toBeVisible()
  await dialog.getByRole("button", { name: "Delete subtree" }).click()
}

export function streamingMarkers(page: Page) {
  return page.locator(
    'article[data-message-status="streaming"]:has([data-slot-layer="present"])'
  )
}

export async function expectStreamingCount(page: Page, n: number) {
  await expect(streamingMarkers(page)).toHaveCount(n)
}
