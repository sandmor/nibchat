import { tool, type Tool } from "ai"
import type { ToolInvocationPart } from "@/lib/types"
import { listHelperProfiles } from "@/lib/agent/helper-profiles"
import {
  CONTINUE_TASK_TOOL_NAME,
  TASK_TOOL_NAME,
  continueTaskInputSchema,
  taskInputSchema,
  taskToolDescription,
  type ContinueTaskInput,
  type TaskInput,
  type TaskProgress,
  type TaskToolOutput,
} from "./task-shared"

export type TaskToolContext = {
  userId: string
  parentChatId: string
  parentNodeId: string
  generationId?: string
  timeZone: string
  abortSignal: AbortSignal
  publish: (tool: ToolInvocationPart) => Promise<void>
}

export function taskProgressPart(
  toolCallId: string,
  input: TaskInput | ContinueTaskInput,
  progress: TaskProgress,
  toolName: string = TASK_TOOL_NAME
): ToolInvocationPart {
  return {
    type: "tool-invocation",
    toolCallId,
    toolName,
    state: "input-available",
    input,
    metadata: { task: progress },
  }
}

export async function createTaskTools(ctx: TaskToolContext): Promise<{
  task: Tool<TaskInput, TaskToolOutput>
  continue_task: Tool<ContinueTaskInput, TaskToolOutput>
}> {
  const profiles = await listHelperProfiles(ctx.userId)
  const task = tool({
    description: taskToolDescription(profiles),
    inputSchema: taskInputSchema,
    execute: async (input, options) => {
      const { runAgentTask } = await import("@/lib/agent/task-run")
      return runAgentTask({
        context: {
          ...ctx,
          abortSignal: options.abortSignal ?? ctx.abortSignal,
        },
        toolCallId: options.toolCallId,
        input,
      })
    },
  })
  const continue_task = tool({
    description:
      "Continue a helper that returned a useful answer and needs more work. Pass its task_id and a new focused prompt. If a helper returned no answer or stopped, use the other results or start a narrower task.",
    inputSchema: continueTaskInputSchema,
    execute: async (input, options) => {
      const { runAgentTask } = await import("@/lib/agent/task-run")
      return runAgentTask({
        context: {
          ...ctx,
          abortSignal: options.abortSignal ?? ctx.abortSignal,
        },
        toolCallId: options.toolCallId,
        input,
      })
    },
  })
  return { task, [CONTINUE_TASK_TOOL_NAME]: continue_task }
}
