import type { ToolSet } from "ai"
import { questionTool } from "./question"

/** Tools registered for every generation. Client tools omit `execute`. */
export const veroTools = {
  question: questionTool,
} satisfies ToolSet

export type VeroTools = typeof veroTools

export {
  formatQuestionResult,
  validateQuestionAnswers,
  answersFromResumeOutput,
  questionInputSchema,
  type QuestionAnswers,
  type QuestionInput,
  type QuestionToolOutput,
} from "./question"
