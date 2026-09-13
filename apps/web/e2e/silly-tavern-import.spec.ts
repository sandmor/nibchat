import { expect, test } from "@playwright/test"
import { ensureWorkspace, openBranchPrev } from "./helpers/workspace"

function pngCard(card: unknown) {
  const encoder = new TextEncoder()
  const payload = Buffer.from(JSON.stringify(card)).toString("base64")
  const text = encoder.encode(`chara\0${payload}`)
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(data.length + 12)
    new DataView(out.buffer).setUint32(0, data.length)
    out.set(encoder.encode(type), 4)
    out.set(data, 8)
    return out
  }
  return Buffer.from(
    new Uint8Array([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...chunk("tEXt", text),
      ...chunk("IEND", new Uint8Array()),
    ])
  )
}

test("imports a SillyTavern JSONL with its selected swipe as a branch", async ({
  page,
}) => {
  await ensureWorkspace(page)
  const title = `ST import ${Date.now()}`
  const jsonl = [
    { chat_metadata: { variables: { imported_place: "library" } } },
    { name: "User", is_user: true, mes: "Hello" },
    {
      name: "Ada",
      mes: "Selected answer",
      swipes: ["First answer", "Selected answer"],
      swipe_id: 1,
    },
  ]
    .map((row) => JSON.stringify(row))
    .join("\n")

  await page.goto("/settings")
  await expect(
    page.getByText("Import conversations", { exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "SillyTavern" }).click()
  await page.locator('input[type="file"][accept*=".jsonl"]').setInputFiles({
    name: `${title}.jsonl`,
    mimeType: "application/jsonl",
    buffer: Buffer.from(jsonl),
  })
  await expect(page.getByText(title, { exact: true })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByText(title, { exact: true }).click()
  await page.getByRole("button", { name: "Import 1 selected" }).click()
  await expect(page.getByText("Imported 1 conversation")).toBeVisible({
    timeout: 20_000,
  })

  await page.goto("/chat/new")
  await page.getByRole("button", { name: "Recents", exact: true }).click()
  await page.getByRole("link", { name: new RegExp(title) }).click()
  await expect(page.getByText("Selected answer", { exact: true })).toBeVisible()
  await openBranchPrev(page)
  await expect(page.getByText("First answer", { exact: true })).toBeVisible()
})

test("imports a SillyTavern character card with no chats", async ({ page }) => {
  await ensureWorkspace(page)
  const name = `ST card ${Date.now()}`

  await page.goto("/settings")
  await page.getByRole("button", { name: "SillyTavern" }).click()
  await expect(
    page.getByText("Import from SillyTavern", { exact: true })
  ).toBeVisible()
  await page.locator('input[type="file"][accept*=".png"]').setInputFiles({
    name: `${name}.png`,
    mimeType: "image/png",
    buffer: pngCard({
      spec: "chara_card_v2",
      data: { name, description: "Imported without chats" },
    }),
  })
  await expect(page.getByText(name, { exact: true })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText("No chats in this export")).toBeVisible()
  await page.getByText(name, { exact: true }).click()
  await page.getByRole("button", { name: "Import 1 character" }).click()
  await expect(page.getByText("Imported 1 character")).toBeVisible({
    timeout: 20_000,
  })

  await page.goto("/chat/new")
  await page.getByRole("button", { name: "Spaces", exact: true }).click()
  await page.getByRole("link", { name: "SillyTavern Imports" }).click()
  await expect(
    page.getByRole("heading", { name: "Spaces inside" })
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole("list").getByRole("link", { name })).toBeVisible()
})
