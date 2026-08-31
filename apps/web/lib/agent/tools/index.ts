import type { ToolSet } from "ai"
import { questionTool } from "./question"
import { builtInToolIds } from "./catalog"

/** Tools registered for every generation. Client tools omit `execute`. */
export const nibchatTools = {
  question: questionTool,
} satisfies ToolSet

export type NibchatTools = typeof nibchatTools

export function selectNibchatTools(
  disabledIds: Iterable<string> = []
): ToolSet {
  const disabled = new Set(disabledIds)
  return Object.fromEntries(
    Object.entries(nibchatTools).filter(([id]) => !disabled.has(id))
  )
}

/** Every built-in id, including disabled ones — MCP must not squat on these. */
export const reservedBuiltInToolNames: readonly string[] = builtInToolIds

export {
  builtInToolCatalog,
  builtInToolIds,
  builtInToolsToJson,
  defaultBuiltInToolsPrefs,
  isBuiltInToolId,
  normalizeBuiltInToolsDisabled,
  parseBuiltInToolsJson,
  type BuiltInToolId,
  type BuiltInToolsPrefs,
} from "./catalog"

export {
  formatQuestionResult,
  validateQuestionAnswers,
  answersFromResumeOutput,
  questionInputSchema,
  type QuestionAnswers,
  type QuestionInput,
  type QuestionToolOutput,
} from "./question"
