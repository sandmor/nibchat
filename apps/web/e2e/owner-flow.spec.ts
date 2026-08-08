import { expect, test } from "@playwright/test"

test.describe.configure({ mode: "serial" })

test.describe("owner flow", () => {
  test("first signup claims the instance and reaches the workspace", async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByText("private AI workspace")).toBeVisible()
    await expect(page.getByText("Make this yours.")).toBeVisible()

    await page.getByLabel("Name").fill("Owner")
    await page.getByLabel("Email").fill("owner@example.com")
    await page.getByLabel("Password").fill("password12345")
    await page.getByRole("button", { name: "Create owner account" }).click()

    await expect(page.getByText("Write anything to begin")).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole("button", { name: /settings/i }).first()
    ).toBeVisible()
  })

  test("further visits show sign-in when claimed", async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto("/")
    await expect(page.getByText("Welcome back.")).toBeVisible({
      timeout: 15_000,
    })
    await page.getByLabel("Email").fill("intruder@example.com")
    await page.getByLabel("Password").fill("password12345")
    await page.getByRole("button", { name: "Sign in" }).click()
    // Stay on the auth surface (unknown user / failed sign-in).
    await expect(page.getByText("private AI workspace")).toBeVisible({
      timeout: 10_000,
    })
    await context.close()
  })
})
