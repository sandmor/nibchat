import { tool, type Tool } from "ai"
import {
  questionInputSchema,
  type QuestionInput,
} from "./question-shared"

export {
  formatQuestionResult,
  validateQuestionAnswers,
  answersFromResumeOutput,
  questionInputSchema,
  type QuestionAnswers,
  type QuestionInput,
  type QuestionPrompt,
  type QuestionToolOutput,
} from "./question-shared"

export const questionTool: Tool<QuestionInput, never> = tool({
  description: [
    "Ask the user interactive questions during execution and wait for their answers.",
    "Use when you need preferences, clarifications, or decisions instead of guessing.",
    "Ask one batch at a time; answers are not available until this tool returns.",
    "Options must be genuinely distinct — do not include an Other/catch-all option;",
    "a freeform input is added automatically unless custom is false.",
    "If you recommend an option, put it first and append (Recommended) to its label.",
  ].join(" "),
  inputSchema: questionInputSchema,
  // No execute: client collects answers, then resume supplies the result.
})
