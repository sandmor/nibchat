import { describe, expect, it } from "vitest"
import { openBrowserArchive } from "@/lib/imports/adapters/browser-archive"
import { chatgptFormat } from "@/lib/imports/adapters/chatgpt"

async function read(document: unknown) {
  return readJson(JSON.stringify(document))
}

async function readJson(json: string) {
  const archive = await openBrowserArchive(
    new File([json], "conversations.json")
  )
  const conversations = []
  for await (const conversation of chatgptFormat.conversations(archive))
    conversations.push(conversation)
  return conversations
}

describe("ChatGPT import adapter", () => {
  it("reconstructs parent-only trees and follows current_node", async () => {
    const conversations = await read([
      {
        conversation_id: "c1",
        title: "Tree",
        create_time: 1,
        update_time: 3,
        current_node: "second",
        mapping: {
          root: { parent: null, message: null },
          user: {
            parent: "root",
            message: {
              author: { role: "user" },
              create_time: 1,
              content: { content_type: "text", parts: ["Hello"] },
            },
          },
          first: {
            parent: "user",
            message: {
              author: { role: "assistant" },
              create_time: 2,
              content: { content_type: "text", parts: ["First"] },
            },
          },
          second: {
            parent: "user",
            message: {
              author: { role: "assistant" },
              create_time: 3,
              content: { content_type: "text", parts: ["Second"] },
            },
          },
        },
      },
    ])
    expect(conversations).toHaveLength(1)
    expect(conversations[0]?.selectedRootId).toBe("user")
    expect(
      conversations[0]?.nodes.find((node) => node.id === "user")
        ?.selectedChildId
    ).toBe("second")
    expect(
      conversations[0]?.nodes.map((node) => [node.id, node.parentId])
    ).toEqual([
      ["user", null],
      ["first", "user"],
      ["second", "user"],
    ])
  })

  it("keeps source-only instructions but excludes them from future context", async () => {
    const conversations = await read([
      {
        id: "c2",
        mapping: {
          root: { parent: null, children: ["system"] },
          system: {
            parent: "root",
            children: [],
            message: {
              author: { role: "system" },
              content: { content_type: "text", parts: ["Instruction"] },
            },
          },
        },
      },
    ])
    expect(conversations[0]?.nodes[0]).toMatchObject({
      role: "system",
      excluded: true,
    })
  })

  it("rejects an HTML-only export", async () => {
    const archive = await openBrowserArchive(
      new File(["<html />"], "chat.html")
    )
    const consume = async () => {
      for await (const conversation of chatgptFormat.conversations(archive))
        void conversation
    }
    await expect(consume()).rejects.toThrow("No conversations JSON")
  })

  it("rejects a conversations array missing its closing bracket", async () => {
    const json = JSON.stringify([
      {
        id: "truncated",
        mapping: {
          root: {
            parent: null,
            message: {
              author: { role: "user" },
              content: { content_type: "text", parts: ["Hello"] },
            },
          },
        },
      },
    ]).slice(0, -1)
    await expect(readJson(json)).rejects.toThrow("incomplete")
  })
})
