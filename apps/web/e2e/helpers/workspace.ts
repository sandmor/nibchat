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
  const profile = {
    name: "E2E Mock",
    kind: "openai-compatible" as const,
    baseUrl,
    apiKey: "sk-e2e-test-key",
    models: ["e2e-model"],
  }

  const existingId = await findE2eMockProviderId(page)
  if (existingId) {
    const updated = await page.request.post(
      "/api/trpc/workspace.updateProvider?batch=1",
      {
        headers: { "content-type": "application/json" },
        data: JSON.stringify({
          "0": { json: { id: existingId, ...profile } },
        }),
      }
    )
    if (updated.ok()) {
      await page.goto("/chat/new")
      await expect(page.getByText("Write anything to begin")).toBeVisible({
        timeout: 15_000,
      })
      return
    }
  }

  // tRPC httpBatchLink shape (single op batch).
  let create = await page.request.post(
    "/api/trpc/workspace.createProvider?batch=1",
    {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({
        "0": { json: profile },
      }),
    }
  )

  if (!create.ok()) {
    create = await page.request.post("/api/trpc/workspace.createProvider", {
      headers: { "content-type": "application/json" },
      data: JSON.stringify({ json: profile }),
    })
  }

  if (!create.ok()) {
    await page.goto("/settings")
    await expect(page.getByText("Model providers")).toBeVisible()
    if ((await page.getByText("E2E Mock").count()) > 0) {
      await page.goto("/chat/new")
      return
    }
    await page.locator("label:text-is('Display name')").locator("..").getByRole("textbox").fill("E2E Mock")
    await page.locator("label:text-is('Models (comma-separated)')").locator("..").getByRole("textbox").fill("e2e-model")
    await page.locator("label:text-is('Base URL')").locator("..").getByRole("textbox").fill(baseUrl)
    await page.locator("label:text-is('Stored API key')").locator("..").getByRole("textbox").fill("sk-e2e-test-key")
    await page.getByRole("button", { name: "Save provider" }).click()
    await expect(page.getByText("E2E Mock")).toBeVisible({ timeout: 15_000 })
    await page.goto("/chat/new")
    await expect(page.getByText("Write anything to begin")).toBeVisible({
      timeout: 15_000,
    })
    return
  }

  await page.goto("/chat/new")
  await expect(page.getByText("Write anything to begin")).toBeVisible({
    timeout: 15_000,
  })
}

async function findE2eMockProviderId(page: Page): Promise<string | null> {
  const list = await page.request.get("/api/trpc/workspace.listProviders")
  if (!list.ok()) return null
  const body: unknown = await list.json()
  const stack: unknown[] = [body]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (Array.isArray(cur)) {
      for (const item of cur) {
        if (
          item &&
          typeof item === "object" &&
          "name" in item &&
          (item as { name: unknown }).name === "E2E Mock" &&
          "id" in item &&
          typeof (item as { id: unknown }).id === "string"
        ) {
          return (item as { id: string }).id
        }
        stack.push(item)
      }
      continue
    }
    if (cur && typeof cur === "object") {
      for (const value of Object.values(cur as Record<string, unknown>)) {
        stack.push(value)
      }
    }
  }
  return null
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
  const composer = page.getByPlaceholder("Message Vero…")
  await composer.fill(content)
  await page.getByRole("button", { name: "Send" }).click()
}

export async function expectAssistantText(
  page: Page,
  text: string | RegExp,
  options?: { timeout?: number }
) {
  await expect(
    page.locator("article").filter({ hasText: text }).first()
  ).toBeVisible({
    timeout: options?.timeout ?? 30_000,
  })
}

export async function expectNoAssistantText(page: Page, text: string | RegExp) {
  await expect(page.locator("article").filter({ hasText: text })).toHaveCount(0)
}

export async function expectUserMessage(page: Page, text: string) {
  await expect(
    page
      .locator("article")
      .filter({ has: page.getByText("user", { exact: true }) })
      .filter({ hasText: text })
  ).toBeVisible()
}

export async function openBranchNext(page: Page) {
  // Prefer the first enabled control (root of the active path). After regenerate
  // there can be multiple sibling switchers (user forks + assistant siblings).
  await page
    .getByRole("button", { name: "Next branch" })
    .filter({ hasNot: page.locator("[disabled]") })
    .first()
    .click()
}

export async function openBranchPrev(page: Page) {
  await page
    .getByRole("button", { name: "Previous branch" })
    .filter({ hasNot: page.locator("[disabled]") })
    .first()
    .click()
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
  return page.getByText("assistant · streaming")
}

export async function expectStreamingCount(page: Page, n: number) {
  await expect(streamingMarkers(page)).toHaveCount(n)
}

