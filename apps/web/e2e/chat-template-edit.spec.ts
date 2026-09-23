import { expect, test } from "@playwright/test"
import { startMockLlm } from "./helpers/mock-llm"
import {
  ensureMockProvider,
  ensureWorkspace,
  expectAssistantText,
  openChatHeaderMore,
  sendMessage,
} from "./helpers/workspace"

test("edits a template in place and uses the updated tree", async ({
  page,
}) => {
  const llm = await startMockLlm()
  try {
    await ensureWorkspace(page)
    await ensureMockProvider(page, llm.baseUrl)
    await page.goto("/chat/new")
    llm.enqueue({ text: "TEMPLATE_FIRST_REPLY" })
    await sendMessage(page, "First template prompt")
    await expectAssistantText(page, "TEMPLATE_FIRST_REPLY")

    const name = `Editable template ${Date.now()}`
    await openChatHeaderMore(page)
    await page.getByRole("menuitem", { name: "Save as template" }).click()
    const save = page.getByRole("dialog", { name: "Save chat template" })
    await save.getByLabel("Name").fill(name)
    await save.getByLabel("Name").press("Enter")
    await expect(save).toBeHidden()

    await page.goto("/settings")
    const row = page.locator("div.rounded-lg").filter({
      has: page.getByRole("button", { name: `Rename ${name}` }),
    })
    await row.getByRole("link", { name: "Edit" }).click()
    await expect(page).toHaveURL(/\/template\//)
    await expect(
      page.getByText("The message tree saves as you edit")
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: "Chat templates" })
    ).toHaveAttribute("href", "/settings#chat-templates")

    llm.enqueue({ text: "TEMPLATE_EDIT_REPLY" })
    await sendMessage(page, "Second template prompt")
    await expectAssistantText(page, "TEMPLATE_EDIT_REPLY")
    await page.reload()
    await expect(page.getByText("Second template prompt")).toBeVisible()

    await page.goto("/settings")
    await row.getByRole("link", { name: "Use" }).click()
    await expect(page).toHaveURL(/\/chat\/new\?template=/)
    await expect(page.getByText("Second template prompt")).toBeVisible()
  } finally {
    await llm.close()
  }
})
