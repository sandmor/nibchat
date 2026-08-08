import type { ToolSet } from "ai"
import { questionTool } from "./question"

/** Tools registered for every generation. Client tools omit `execute`. */
export const nibchatTools = {
  question: questionTool,
} satisfies ToolSet

export type NibchatTools = typeof nibchatTools

export {
  formatQuestionResult,
  validateQuestionAnswers,
  answersFromResumeOutput,
  questionInputSchema,
  type QuestionAnswers,
  type QuestionInput,
  type QuestionToolOutput,
} from "./question"
