import { z } from "zod"

export const questionOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string(),
})

export const questionPromptSchema = z.object({
  question: z.string().min(1),
  header: z.string().min(1).max(30),
  options: z.array(questionOptionSchema).min(1),
  multiple: z.boolean().optional().default(false),
  /** When true (default), offers a freeform “type your own answer” input. */
  custom: z.boolean().optional().default(true),
})

export const questionInputSchema = z.object({
  questions: z.array(questionPromptSchema).min(1),
})

export type QuestionInput = z.infer<typeof questionInputSchema>
export type QuestionPrompt = z.infer<typeof questionPromptSchema>

/** Per-question selected labels (or freeform strings). */
export type QuestionAnswers = string[][]

export type QuestionToolOutput = {
  title: string
  output: string
  metadata: { answers: QuestionAnswers }
}

export function formatQuestionResult(
  questions: QuestionPrompt[],
  answers: QuestionAnswers
): QuestionToolOutput {
  const n = questions.length
  const title = `Asked ${n} question${n === 1 ? "" : "s"}`
  const pairs = questions.map((q, i) => {
    const selected = answers[i] ?? []
    const value =
      selected.length === 0 ? "Unanswered" : selected.join(", ")
    return `"${q.question}"="${value}"`
  })
  const output = `User has answered your questions: ${pairs.join(", ")}. You can now continue with the user's answers in mind.`
  return {
    title,
    output,
    metadata: { answers },
  }
}

/**
 * Validate answers against a stored question tool input.
 * Returns cleaned answers (same length as questions) or an error message.
 */
export function validateQuestionAnswers(
  input: unknown,
  answers: unknown
): { ok: true; answers: QuestionAnswers } | { ok: false; error: string } {
  const parsed = questionInputSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, error: "Invalid stored question tool input." }
  if (!Array.isArray(answers))
    return { ok: false, error: "Answers must be an array of label arrays." }

  const questions = parsed.data.questions
  if (answers.length !== questions.length)
    return {
      ok: false,
      error: `Expected ${questions.length} answer group(s), got ${answers.length}.`,
    }

  const cleaned: QuestionAnswers = []
  for (let i = 0; i < questions.length; i++) {
    const prompt = questions[i]!
    const group = answers[i]
    if (!Array.isArray(group))
      return { ok: false, error: `Answer group ${i} must be an array of strings.` }
    const labels = group.map((x) => {
      if (typeof x !== "string") return null
      return x.trim()
    })
    if (labels.some((l) => l == null))
      return { ok: false, error: `Answer group ${i} contains a non-string label.` }
    const nonEmpty = labels.filter((l): l is string => Boolean(l && l.length > 0))

    if (!prompt.multiple && nonEmpty.length > 1)
      return {
        ok: false,
        error: `Question ${i + 1} allows only one selection.`,
      }

    const optionLabels = new Set(prompt.options.map((o) => o.label))
    for (const label of nonEmpty) {
      if (!optionLabels.has(label) && !prompt.custom)
        return {
          ok: false,
          error: `Invalid option for question ${i + 1}: ${label}`,
        }
    }
    cleaned.push(nonEmpty)
  }
  return { ok: true, answers: cleaned }
}

/** Parse resume payload for a question tool call into structured answers. */
export function answersFromResumeOutput(
  output: unknown
): QuestionAnswers | null {
  if (output && typeof output === "object" && "metadata" in output) {
    const meta = (output as { metadata?: unknown }).metadata
    if (meta && typeof meta === "object" && "answers" in meta) {
      const answers = (meta as { answers: unknown }).answers
      if (Array.isArray(answers)) return answers as QuestionAnswers
    }
  }
  if (Array.isArray(output)) return output as QuestionAnswers
  return null
}
