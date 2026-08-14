import { describe, expect, it } from "vitest"
import { shouldDeleteUploadedAttachment } from "./conversation-session-store"

describe("shouldDeleteUploadedAttachment", () => {
  it("deletes abandoned uploads and keeps files already claimed onto a message", () => {
    const file = {
      name: "shot.png",
      reference: { kind: "uploaded-file" as const, id: "att-1" },
    }
    expect(shouldDeleteUploadedAttachment(file)).toBe(true)
    expect(shouldDeleteUploadedAttachment({ ...file, claimed: true })).toBe(
      false
    )
  })
})
