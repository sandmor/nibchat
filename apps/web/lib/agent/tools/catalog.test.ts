import { describe, expect, it } from "vitest"
import {
  builtInToolIds,
  builtInToolsToJson,
  defaultBuiltInToolsPrefs,
  normalizeBuiltInToolsDisabled,
  parseBuiltInToolsJson,
} from "./catalog"
import { nibchatTools, selectNibchatTools } from "./index"

describe("built-in tool catalog", () => {
  it("lists the same ids as nibchatTools", () => {
    expect([...builtInToolIds].sort()).toEqual(Object.keys(nibchatTools).sort())
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

  it("selectNibchatTools omits disabled tools and keeps others", () => {
    expect(Object.keys(selectNibchatTools([]))).toEqual(
      Object.keys(nibchatTools)
    )
    expect(selectNibchatTools(["unknown"])).toEqual(nibchatTools)
    expect(Object.keys(selectNibchatTools(["question"]))).toEqual([])
  })
})
