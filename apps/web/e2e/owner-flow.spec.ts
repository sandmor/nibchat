import { expect, test, type BrowserContext, type Page } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("owner flow", () => {
  // One browser context for the whole serial suite (cookies survive between tests).
  let context: BrowserContext
  let page: Page

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext()
    page = await context.newPage()
  })

  test.afterAll(async () => {
    await context.close()
  })

  test("first signup claims the instance and reaches the workspace", async () => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/setup$/)
    await expect(page.getByText("private AI workspace")).toBeVisible()
    await expect(page.getByText("Make this yours.")).toBeVisible()

    await page.getByLabel("Name").fill("Owner")
    await page.getByLabel("Email").fill("owner@example.com")
    await page.getByLabel("Password").fill("password12345")
    await page.getByRole("button", { name: "Create owner account" }).click()

    await expect(page).toHaveURL(/\/chat\/new$/, { timeout: 30_000 })
    await expect(page.getByText("Write anything to begin")).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole("link", { name: /settings/i }).first()
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: /new conversation/i }).first()
    ).toHaveAttribute("href", "/chat/new")
  })

  test("settings nav opens and returns via chats link", async () => {
    await page.goto("/chat/new")
    await expect(page).toHaveURL(/\/chat\/new$/)
    await page
      .getByRole("link", { name: /^settings$/i })
      .first()
      .click()
    await expect(page).toHaveURL(/\/settings$/)
    await page
      .getByRole("link", { name: /^chats$/i })
      .first()
      .click()
    await expect(page).toHaveURL(/\/chat\//)
  })

  test("second signup is blocked when instance is claimed", async ({
    browser,
  }) => {
    const intruder = await browser.newContext()
    const p = await intruder.newPage()

    // API-level: signup must not claim or return 200 once owned.
    const signup = await p.request.post("/api/auth/sign-up/email", {
      data: {
        name: "Intruder",
        email: "intruder-signup@example.com",
        password: "password12345",
      },
    })
    expect(signup.status()).toBe(403)
    const body = (await signup.json().catch(() => ({}))) as {
      message?: string
    }
    expect(body.message ?? "").toMatch(/already claimed/i)

    await p.goto("/setup")
    await expect(p).toHaveURL(/\/login$/)
    await expect(p.getByText("Welcome back.")).toBeVisible({
      timeout: 15_000,
    })
    await intruder.close()
  })

  test("unknown credentials stay on sign-in", async ({ browser }) => {
    const bare = await browser.newContext()
    const p = await bare.newPage()
    await p.goto("/")
    await expect(p).toHaveURL(/\/login$/)
    await expect(p.getByText("Welcome back.")).toBeVisible({
      timeout: 15_000,
    })
    await p.getByLabel("Email").fill("intruder@example.com")
    await p.getByLabel("Password").fill("password12345")
    await p.getByRole("button", { name: "Sign in" }).click()
    await expect(p.getByText("private AI workspace")).toBeVisible({
      timeout: 10_000,
    })
    await expect(p).toHaveURL(/\/login$/)
    await bare.close()
  })
})
