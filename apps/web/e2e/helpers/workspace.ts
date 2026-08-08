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
    await page.getByLabel("Name").fill(OWNER.name)
    await page.getByLabel("Email").fill(OWNER.email)
    await page.getByLabel("Password").fill(OWNER.password)
    await page.getByRole("button", { name: "Create owner account" }).click()
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

async function ensureMockProviderViaSettingsUi(page: Page, baseUrl: string) {
  await page.goto("/settings")
  await expect(page.getByText("Model providers")).toBeVisible({
    timeout: 15_000,
  })

  const editInMockRow = page
    .locator("div.flex.flex-wrap")
    .filter({ hasText: "E2E Mock" })
    .getByRole("button", { name: "Edit", exact: true })

  if ((await editInMockRow.count()) > 0) {
    await editInMockRow.first().click()
  } else {
    await page
      .locator("label:text-is('Display name')")
      .locator("..")
      .getByRole("textbox")
      .fill("E2E Mock")
    await page
      .locator("label:text-is('Models (comma-separated)')")
      .locator("..")
      .getByRole("textbox")
      .fill("e2e-model")
  }

  await page
    .locator("label:text-is('Base URL')")
    .locator("..")
    .getByRole("textbox")
    .fill(baseUrl)
  await page
    .locator("label:text-is('Stored API key')")
    .locator("..")
    .getByRole("textbox")
    .fill("sk-e2e-test-key")

  await page
    .getByRole("button", { name: /^(Save provider|Update provider)$/ })
    .click()
  await expect(page.getByText("Provider saved", { exact: false })).toBeVisible({
    timeout: 15_000,
  }).catch(async () => {
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
  await page.getByRole("link", { name: new RegExp(title) }).first().click()
  await expect(page).toHaveURL(/\/chat\//, { timeout: 15_000 })
  await expect(page.getByRole("heading", { name: title })).toBeVisible({
    timeout: 15_000,
  })
}

export async function sendMessage(page: Page, content: string) {
  const composer = page.getByPlaceholder("Message Nibchat…")
  await composer.fill(content)
  await page.getByRole("button", { name: "Send" }).click()
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
    page
      .locator('[data-slot-layer="present"]')
      .filter({ has: page.getByText("user", { exact: true }) })
      .filter({ hasText: text })
  ).toBeVisible()
}

export async function openBranchNext(page: Page) {
  const button = page
    .locator('[data-slot-layer="present"]')
    .getByRole("button", { name: "Next branch", disabled: false })
  await expect(button).toBeEnabled()
  await button.scrollIntoViewIfNeeded()
  await button.click()
}

export async function openBranchPrev(page: Page) {
  const button = page
    .locator('[data-slot-layer="present"]')
    .getByRole("button", { name: "Previous branch", disabled: false })
  await expect(button).toBeEnabled()
  await button.scrollIntoViewIfNeeded()
  await button.click()
}

export async function editUserAsBranch(page: Page, nextText: string) {
  // User bubble is the right-aligned article; open edit from the active path tip user.
  const userArticles = page.locator("article").filter({
    has: page.getByText("user", { exact: true }),
  })
  await userArticles.last().getByRole("button", { name: "Edit as branch" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Edit as branch")).toBeVisible()
  await dialog.locator("textarea").fill(nextText)
  await dialog.getByRole("button", { name: "Save & generate" }).click()
}

export async function regenerateAssistant(page: Page) {
  const assistant = page.locator("article").filter({
    has: page.getByText("assistant", { exact: true }),
  })
  await assistant.last().getByRole("button", { name: "Regenerate" }).click()
}

export async function deleteActiveUserSubtree(page: Page) {
  const user = page.locator("article").filter({
    has: page.getByText("user", { exact: true }),
  })
  await user.last().getByRole("button", { name: "Delete" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByText("Delete message node")).toBeVisible()
  await dialog.getByRole("button", { name: "Delete subtree" }).click()
}

export async function deleteActiveAssistantSubtree(page: Page) {
  const assistant = page.locator("article").filter({
    has: page.getByText("assistant", { exact: true }),
  })
  await assistant.last().getByRole("button", { name: "Delete" }).click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog.getByText("Delete message node")).toBeVisible()
  await dialog.getByRole("button", { name: "Delete subtree" }).click()
}

export function streamingMarkers(page: Page) {
  return page
    .locator('[data-slot-layer="present"]')
    .getByText("assistant · streaming")
}

export async function expectStreamingCount(page: Page, n: number) {
  await expect(streamingMarkers(page)).toHaveCount(n)
}

