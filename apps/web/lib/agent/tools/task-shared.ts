import { z } from "zod"
import { MAX_PROMPT_CHARS } from "@/lib/limits"
import type { ToolInvocationPart } from "@/lib/types"

export const TASK_TOOL_NAME = "task"
export const CONTINUE_TASK_TOOL_NAME = "continue_task"

export const taskInputSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PROMPT_CHARS)
    .describe("A focused assignment for the helper."),
  agent: z
    .string()
    .optional()
    .describe("Optional specialist key. Omit for an ad hoc helper."),
  context: z
    .enum(["conversation", "task"])
    .optional()
    .describe(
      "Conversation copies the current branch; task sends only this prompt."
    ),
})
export const continueTaskInputSchema = z.object({
  task_id: z
    .string()
    .uuid()
    .describe("The task ID returned by an earlier task call."),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
})
export type TaskInput = z.infer<typeof taskInputSchema>
export type ContinueTaskInput = z.infer<typeof continueTaskInputSchema>
export type TaskToolState =
  | "running"
  | "awaiting_input"
  | "completed"
  | "error"
  | "stopped"
export type TaskToolOutput = {
  task_id: string
  status: Exclude<TaskToolState, "running">
  answer: string
  error?: string
}
export type TaskProgress = {
  runId: string
  helper: string
  description: string
  state: TaskToolState
  preview: string
  question?: { assistantNodeId: string; part: ToolInvocationPart }
}

export function taskProgress(part: ToolInvocationPart): TaskProgress | null {
  const task = part.metadata?.task
  if (!task || typeof task !== "object") return null
  const record = task as Record<string, unknown>
  if (
    typeof record.runId !== "string" ||
    typeof record.helper !== "string" ||
    typeof record.description !== "string" ||
    (record.state !== "running" &&
      record.state !== "awaiting_input" &&
      record.state !== "completed" &&
      record.state !== "error" &&
      record.state !== "stopped")
  )
    return null
  return {
    runId: record.runId,
    helper: record.helper,
    description: record.description,
    state: record.state,
    preview: typeof record.preview === "string" ? record.preview : "",
    ...(record.question && typeof record.question === "object"
      ? {
          question: record.question as {
            assistantNodeId: string
            part: ToolInvocationPart
          },
        }
      : {}),
  }
}

export function taskToolDescription(
  profiles: readonly { key: string; description: string }[]
) {
  return [
    "Ask a helper to complete one focused assignment and return its answer. No setup is needed.",
    "By default it sees this conversation up to the current reply and uses this chat's model. Use context=task for an independent brief; include all needed facts in prompt.",
    "Example: task({prompt: 'Check the proposed fix for cancellation races.'}).",
    "Delegate when work can be done independently or benefits from a specialist. Review results and continue working before answering when needed.",
    ...(profiles.length ? ["Optional specialists:"] : []),
    ...profiles.map((profile) => `- ${profile.key}: ${profile.description}`),
  ].join("\n")
}
