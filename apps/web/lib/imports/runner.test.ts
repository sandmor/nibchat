import { describe, expect, it } from "vitest"
import { MAX_UPLOAD_CHUNK_BYTES } from "@/lib/limits"
import { runImportConversation } from "@/lib/imports/runner"
import type {
  ImportConversation,
  ImportTransportPort,
} from "@/lib/imports/model"

const conversation: ImportConversation = {
  sourceId: "c",
  fingerprint: "a".repeat(64),
  title: "Conversation",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  nodeCount: 1,
  selectedRootId: "n",
  warnings: [],
  nodes: [
    {
      id: "n",
      parentId: null,
      selectedChildId: null,
      role: "user",
      parts: [{ type: "asset", assetId: "a" }],
      createdAt: "2025-01-01T00:00:00.000Z",
      excluded: false,
    },
  ],
  assets: [{ id: "a", name: "image.png", mediaType: "image/png" }],
}

describe("import runner", () => {
  it("resumes attachment and node checkpoints", async () => {
    const uploaded: Array<{ offset: number; size: number }> = []
    let nodeOffset = -1
    const transport: ImportTransportPort = {
      begin: async () => ({ status: "staging", nextNode: 0 }),
      assetStatus: async () => ({
        offset: MAX_UPLOAD_CHUNK_BYTES,
        ready: false,
      }),
      assetChunk: async (_id, _asset, offset, bytes) => {
        uploaded.push({ offset, size: bytes.length })
      },
      finishAsset: async () => ({ status: "ready" }),
      omitAsset: async () => undefined,
      nodes: async (_id, offset) => {
        nodeOffset = offset
      },
      publish: async () => ({ status: "imported", chatId: "chat" }),
    }
    const bytes = new Uint8Array(MAX_UPLOAD_CHUNK_BYTES + 10)
    const outcome = await runImportConversation(
      "c",
      { conversation: async () => conversation, asset: async () => bytes },
      transport,
      new AbortController().signal
    )
    expect(uploaded).toEqual([{ offset: MAX_UPLOAD_CHUNK_BYTES, size: 10 }])
    expect(nodeOffset).toBe(0)
    expect(outcome).toEqual({ status: "imported", chatId: "chat" })
  })
})
