import type { ToolSet } from "ai"
import { questionTool } from "./question"
import { createTaskTools, type TaskToolContext } from "./task"
import { builtInToolIds } from "./catalog"

export async function createNibchatTools(input: {
  disabled?: Iterable<string>
  task?: TaskToolContext | null
}): Promise<ToolSet> {
  const disabled = new Set(input.disabled ?? [])
  const tools: ToolSet = {}
  if (!disabled.has("question")) tools.question = questionTool
  if (input.task && (!disabled.has("task") || !disabled.has("continue_task"))) {
    Object.assign(tools, await createTaskTools(input.task))
    if (disabled.has("task")) delete tools.task
    if (disabled.has("continue_task")) delete tools.continue_task
  }
  return tools
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

export type { TaskToolContext } from "./task"
