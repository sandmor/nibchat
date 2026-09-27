import { describe, expect, it } from "vitest"
import {
  builtInToolIds,
  builtInToolsToJson,
  defaultBuiltInToolsPrefs,
  normalizeBuiltInToolsDisabled,
  parseBuiltInToolsJson,
} from "./catalog"
import { createNibchatTools } from "./index"

describe("built-in tool catalog", () => {
  it("lists the helper tools in the catalog", () => {
    expect([...builtInToolIds].sort()).toEqual(["continue_task", "question", "task"])
  })

  it("parses a stored disabled list", () => {
    expect(
      parseBuiltInToolsJson(builtInToolsToJson(defaultBuiltInToolsPrefs))
    ).toEqual({ disabled: [] })
    expect(
      parseBuiltInToolsJson(JSON.stringify({ disabled: ["question"] }))
    ).toEqual({ disabled: ["question"] })
  })

  it("drops unknown ids and duplicates from stored json", () => {
    expect(
      parseBuiltInToolsJson(
        JSON.stringify({ disabled: ["question", "nope", "question"] })
      )
    ).toEqual({ disabled: ["question"] })
    expect(normalizeBuiltInToolsDisabled(["nope", "question"])).toEqual([
      "question",
    ])
  })

  it("rejects invalid stored json", () => {
    expect(() => parseBuiltInToolsJson("not-json")).toThrow()
    expect(() => parseBuiltInToolsJson("{}")).toThrow(
      "Invalid built-in tools preferences"
    )
  })

  it("omits disabled client tools", async () => {
    expect(Object.keys(await createNibchatTools({}))).toEqual(["question"])
    expect(Object.keys(await createNibchatTools({ disabled: ["question"] }))).toEqual([])
  })
})
