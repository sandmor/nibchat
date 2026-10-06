import type { ToolSet } from "ai"
import type { DiagnosticOperationHandle } from "@/lib/diagnostics"
import { diagnosticErrorFields } from "@/lib/diagnostics"
import type {
  DiagnosticMetadata,
  DiagnosticTerminalOutcome,
} from "@/lib/diagnostic-contract"

/** Classify only contracts we own, never arbitrary tool output text. */
function toolDiagnosticOutcome(
  toolName: string,
  source: string,
  output: unknown
): DiagnosticTerminalOutcome {
  if (!output || typeof output !== "object") return "complete"
  const value = output as { isError?: unknown; status?: unknown }
  if (source === "mcp" && value.isError === true) return "error"
  if (toolName === "task" || toolName === "continue_task") {
    if (value.status === "error") return "error"
    if (value.status === "stopped") return "cancelled"
    if (value.status === "awaiting_input") return "awaiting_input"
  }
  return "complete"
}

export function createToolDiagnostics(operation: DiagnosticOperationHandle) {
  const handled = new Set<string>()
  return {
    async run<T>(
      toolName: string,
      toolCallId: string,
      execute: () => T | PromiseLike<T>,
      fields: Pick<DiagnosticMetadata, "source" | "replay"> = {},
      signal?: AbortSignal
    ): Promise<T> {
      handled.add(toolCallId)
      const metadata = { toolName, toolCallId, source: "builtin", ...fields }
      await operation.event("tool.started", "info", metadata)
      const startedAt = Date.now()
      try {
        const output = await execute()
        const outcome = toolDiagnosticOutcome(
          toolName,
          metadata.source!,
          output
        )
        await operation.event(
          "tool.finished",
          outcome === "error" ? "warn" : "info",
          {
            ...metadata,
            outcome,
            durationMs: Date.now() - startedAt,
            ...(outcome === "error" ? { reason: "returned_error" } : {}),
          }
        )
        return output
      } catch (error) {
        await operation.event(
          "tool.finished",
          signal?.aborted ? "info" : "warn",
          {
            ...metadata,
            outcome: signal?.aborted ? "cancelled" : "error",
            durationMs: Date.now() - startedAt,
            reason: signal?.aborted ? "aborted" : "execution_failed",
            ...diagnosticErrorFields(error),
          }
        )
        throw error
      }
    },
    async validationFailure(
      toolName: string,
      toolCallId: string,
      error: unknown
    ) {
      if (handled.has(toolCallId)) return
      handled.add(toolCallId)
      await operation.event("tool.finished", "warn", {
        toolName,
        toolCallId,
        outcome: "error",
        phase: "validation",
        reason: "invalid_input",
        ...diagnosticErrorFields(error),
      })
    },
  }
}
export type ToolDiagnostics = ReturnType<typeof createToolDiagnostics>

export function instrumentTools(
  tools: ToolSet,
  diagnostics: ToolDiagnostics
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute
      if (!execute) return [name, definition]
      const mcp = definition.metadata?.mcp as { profileId?: string } | undefined
      return [
        name,
        {
          ...definition,
          execute: (
            input: unknown,
            options: Parameters<NonNullable<typeof execute>>[1]
          ) =>
            diagnostics.run(
              name,
              options.toolCallId,
              () => execute(input, options),
              { source: mcp ? "mcp" : "builtin" },
              options.abortSignal
            ),
        },
      ]
    })
  )
}
