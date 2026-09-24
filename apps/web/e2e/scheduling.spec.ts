import { expect, test } from "@playwright/test"
import { ensureWorkspace } from "./helpers/workspace"

test("schedules a generation from a user message in linear and tree", async ({
  page,
}, testInfo) => {
  await ensureWorkspace(page)
  let releaseSchedules!: () => void
  const schedulesReady = new Promise<void>((resolve) => {
    releaseSchedules = resolve
  })
  await page.route("**/api/trpc/**", async (route) => {
    if (route.request().url().includes("listSchedules")) await schedulesReady
    await route.continue()
  })
  await page.goto("/chat/new")
  const sendOptions = page.getByRole("button", {
    name: "Send options",
    exact: true,
  })
  try {
    await expect(sendOptions).toBeVisible()
  } finally {
    releaseSchedules()
  }
  await expect(sendOptions).toBeVisible()
  await page
    .getByPlaceholder("Message Nibchat…")
    .fill("A delayed linear prompt")
  await sendOptions.click()
  await expect(
    page.getByRole("menuitem", { name: "Generate later…" })
  ).toBeEnabled()
  await page.getByRole("menuitem", { name: "Generate later…" }).click()
  const dialog = page.getByRole("dialog", {
    name: "Generate later",
    exact: true,
  })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveCount(0)
  await expect(dialog.getByText("A delayed linear prompt")).toBeVisible()
  await dialog.getByLabel("Replies per run").fill("3")
  await dialog.locator("#schedule-date").click()
  await expect(page.getByRole("grid")).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath("schedule-calendar.png"),
    animations: "disabled",
  })
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Tomorrow morning" }).click()
  await dialog
    .getByRole("button", { name: "Schedule generation", exact: true })
    .click()
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(/\/chat\/(?!new)[^/]+$/)
  await expect(page.getByText("A delayed linear prompt")).toBeVisible()
  await expect(page.getByTestId("scheduled-generation")).toHaveCount(1)
  await expect(page.getByTestId("scheduled-generation")).toContainText("Generates 3 replies")

  await page.unroute("**/api/trpc/**")
  let releaseList!: () => void
  const listed = new Promise<void>((resolve) => {
    releaseList = resolve
  })
  await page.route("**/api/trpc/**", async (route) => {
    if (route.request().url().includes("listSchedules")) await listed
    await route.continue()
  })
  await page.reload()
  await expect(page.getByTestId("scheduled-generation")).toBeVisible()
  releaseList()

  await page.getByRole("button", { name: "Edit schedule", exact: true }).click()
  const pending = page.getByRole("dialog", {
    name: "Scheduled generation",
    exact: true,
  })
  await expect(pending).toBeVisible()
  await expect(pending.getByLabel("Replies per run")).toHaveValue("3")
  await page.keyboard.press("Escape")
  await expect(pending).not.toBeVisible()
  await page
    .getByRole("button", { name: "Cancel schedule", exact: true })
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel schedule", exact: true })
    .click()
  await expect(page.getByTestId("scheduled-generation")).toHaveCount(0)
  await expect(page.getByText("A delayed linear prompt")).toBeVisible()

  await page.getByRole("button", { name: "Send options", exact: true }).click()
  await page.getByRole("menuitem", { name: "Generate later…" }).click()
  await dialog.getByRole("button", { name: "Tomorrow morning" }).click()
  await dialog
    .getByRole("button", { name: "Schedule generation", exact: true })
    .click()
  await expect(page.getByText("A delayed linear prompt")).toHaveCount(1)
  await expect(page.getByTestId("scheduled-generation")).toHaveCount(1)

  await page.getByRole("button", { name: "Tree", exact: true }).click()
  const tree = page.getByTestId("chat-tree")
  await expect(tree.getByTestId("scheduled-generation")).toHaveCount(1)
  await tree.getByRole("button", { name: "Add branch", exact: true }).click()
  await tree.getByRole("button", { name: "Assistant", exact: true }).click()
  await tree
    .getByPlaceholder("Write an assistant message…")
    .fill("A saved reply")
  await tree.getByRole("button", { name: "Save", exact: true }).click()
  await expect(tree.getByText("A saved reply")).toBeVisible()

  await page.getByRole("button", { name: "Linear", exact: true }).click()
  await expect(page.getByText("A saved reply")).toBeVisible()
  await expect(page.getByText(/Generates /)).toBeVisible()

  await page.getByRole("button", { name: "Tree", exact: true }).click()
  await tree.getByRole("button", { name: "More", exact: true }).first().click()
  await page.getByRole("menuitem", { name: "Generate later…" }).click()
  await dialog.getByRole("button", { name: "Tomorrow morning" }).click()
  await dialog
    .getByRole("button", { name: "Schedule generation", exact: true })
    .click()
  await expect(tree.getByTestId("scheduled-generation")).toHaveCount(2)
  await page.getByRole("button", { name: "Linear", exact: true }).click()
  const transcript = page.getByTestId("chat-transcript-viewport")
  await expect(transcript.getByTestId("scheduled-generation")).toHaveCount(1)
  await expect(transcript.getByText("1/2")).toBeVisible()
  await transcript
    .getByRole("button", { name: "Next scheduled generation", exact: true })
    .click()
  await expect(transcript.getByText("2/2")).toBeVisible()
  await page.getByRole("button", { name: "Tree", exact: true }).click()
  await tree
    .getByRole("button", { name: "Cancel schedule", exact: true })
    .first()
    .click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cancel schedule", exact: true })
    .click()
  await expect(tree.getByTestId("scheduled-generation")).toHaveCount(1)
  await expect(
    tree.getByRole("paragraph").filter({ hasText: "A delayed linear prompt" })
  ).toBeVisible()

  await page.getByRole("button", { name: "Linear", exact: true }).click()
  await expect(page.getByText(/Generates /)).toBeVisible()
  await expect(page.getByText("A delayed linear prompt")).toBeVisible()
  await expect(page.getByText("A saved reply")).toBeVisible()
})
