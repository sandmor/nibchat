import { expect, test } from "@playwright/test"
import { startMockLlm } from "./helpers/mock-llm"
import {
  ensureMockProvider,
  ensureWorkspace,
  expectAssistantText,
  openChatParameters,
  openChatReasoning,
  sendMessage,
} from "./helpers/workspace"

test("configures compatible reasoning, persists the choice, and sends it through fallback", async ({
  page,
}) => {
  const llm = await startMockLlm()
  try {
    await ensureWorkspace(page)
    await ensureMockProvider(page, llm.baseUrl)
    await page.goto("/settings")
    await page
      .getByRole("button", { name: "Edit", exact: true })
      .first()
      .click()
    await page.getByRole("switch", { name: "Advanced", exact: true }).check()
    await page.getByLabel("Reasoning format for e2e-model").click()
    await page
      .getByRole("option", { name: "OpenAI effort", exact: true })
      .click()
    await page
      .getByLabel("Reasoning levels for e2e-model")
      .fill("none, low, medium, high")
    await page
      .getByRole("button", { name: "Update provider", exact: true })
      .click()
    await expect(
      page.getByText("Provider saved", { exact: false })
    ).toBeVisible()
    await page.goto("/chat/new")
    await openChatReasoning(page, "Reasoning: Default")
    await page.getByRole("button", { name: "High", exact: true }).click()
    await expect(
      page.getByRole("button", { name: "Reasoning: High", exact: true })
    ).toBeVisible()
    llm.enqueue({ text: "REASONING_HIGH_REPLY" })
    await sendMessage(page, "test high reasoning")
    await expectAssistantText(page, "REASONING_HIGH_REPLY")
    expect(
      llm
        .requestBodies()
        .filter((body) => body.stream === true)
        .at(-1)?.reasoning_effort
    ).toBe("high")
    await page.reload()
    await openChatReasoning(page, "Reasoning: High")
    await expect(
      page.getByRole("button", { name: "High", exact: true })
    ).toHaveAttribute("aria-pressed", "true")
    await page.getByRole("button", { name: "Default", exact: true }).click()
    llm.enqueue({ text: "REASONING_DEFAULT_REPLY" })
    await sendMessage(page, "test provider default")
    await expectAssistantText(page, "REASONING_DEFAULT_REPLY")
    expect(
      llm
        .requestBodies()
        .filter((body) => body.stream === true)
        .at(-1)
    ).not.toHaveProperty("reasoning_effort")
    await page.setViewportSize({ width: 390, height: 844 })
    await openChatReasoning(page, "Reasoning: Default")
    await page.getByRole("button", { name: "Low", exact: true }).focus()
    await page.keyboard.press("ArrowDown")
    await expect(
      page.getByRole("button", { name: "Medium", exact: true })
    ).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(
      page.getByRole("button", { name: "Reasoning: Medium", exact: true })
    ).toBeVisible()
    await openChatParameters(page)
    const json = '{"E2E Mock":{"reasoningEffort":"low","other":"kept"}}'
    await page.getByLabel("Provider-specific JSON").fill(json)
    await page
      .getByRole("button", { name: "Apply to this chat", exact: true })
      .click()
    await openChatReasoning(page, "Reasoning: Custom")
    await page
      .getByRole("button", { name: "Edit provider JSON", exact: true })
      .click()
    expect(
      JSON.parse(await page.getByLabel("Provider-specific JSON").inputValue())
    ).toEqual(JSON.parse(json))
    await page.keyboard.press("Escape")
    await openChatReasoning(page, "Reasoning: Custom")
    await page
      .getByRole("button", { name: "Use managed controls", exact: true })
      .click()
    await expect(
      page.getByRole("button", { name: "Reasoning: Default", exact: true })
    ).toBeVisible()
    await openChatParameters(page)
    expect(
      JSON.parse(await page.getByLabel("Provider-specific JSON").inputValue())
    ).toEqual({ "E2E Mock": { other: "kept" } })
  } finally {
    await llm.close()
  }
})
