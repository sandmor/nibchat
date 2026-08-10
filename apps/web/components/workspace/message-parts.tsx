"use client"

import { Markdown } from "@/components/markdown"
import { QuestionToolView } from "@/components/workspace/tools/question-tool"
import type { QuestionAnswers } from "@/lib/agent/tools/question-shared"
import type { Parts, ToolInvocationPart } from "@/lib/types"

export function MessageParts({
  parts,
  role,
  streamingPlaceholder,
  interactiveTools,
  onAnswerTool,
}: {
  parts: Parts
  role: string
  streamingPlaceholder?: boolean
  /** Whether pending client tools may be answered on this message. */
  interactiveTools?: boolean
  onAnswerTool?: (
    toolCallId: string,
    toolName: string,
    output: unknown
  ) => void | Promise<void>
}) {
  if (parts.length === 0) {
    if (streamingPlaceholder) {
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <Markdown>Thinking…</Markdown>
        </div>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col gap-3">
      {parts.map((part, index) => {
        if (part.type === "reasoning") {
          return (
            <details
              key={`reasoning-${index}`}
              className="rounded-lg bg-muted p-3 text-xs text-muted-foreground"
            >
              <summary className="cursor-pointer">Reasoning</summary>
              <p className="mt-2 whitespace-pre-wrap">{part.text}</p>
            </details>
          )
        }
        if (part.type === "text") {
          if (role === "assistant") {
            return (
              <div
                key={`text-${index}`}
                className="prose prose-sm dark:prose-invert max-w-none"
              >
                <Markdown>
                  {part.text || (streamingPlaceholder ? "Thinking…" : "")}
                </Markdown>
              </div>
            )
          }
          return (
            <p key={`text-${index}`} className="whitespace-pre-wrap">
              {part.text}
            </p>
          )
        }
        if (part.type === "attachment") {
          const sourceLabel =
            part.source.kind === "mcp-resource"
              ? part.source.profileName
              : undefined
          const sourceDetail =
            part.source.kind === "mcp-resource" ? part.source.uri : undefined
          return (
            <details
              key={part.id}
              className="rounded-lg border border-dashed bg-muted/40 p-3 text-sm"
            >
              <summary className="cursor-pointer font-medium">
                Attached: {part.name}
                {sourceLabel ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {sourceLabel}
                  </span>
                ) : null}
              </summary>
              {sourceDetail ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {sourceDetail}
                </p>
              ) : null}
              <pre className="mt-2 max-h-64 overflow-auto text-xs whitespace-pre-wrap">
                {part.content.text}
              </pre>
              {part.content.truncated ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Truncated from {part.content.truncated.originalCharacters}{" "}
                  characters.
                </p>
              ) : null}
            </details>
          )
        }
        if (part.type === "tool-invocation") {
          return (
            <ToolPart
              key={part.toolCallId}
              part={part}
              interactive={Boolean(
                interactiveTools && part.state === "input-available"
              )}
              onAnswerTool={onAnswerTool}
            />
          )
        }
        return null
      })}
    </div>
  )
}

function ToolPart({
  part,
  interactive,
  onAnswerTool,
}: {
  part: ToolInvocationPart
  interactive: boolean
  onAnswerTool?: (
    toolCallId: string,
    toolName: string,
    output: unknown
  ) => void | Promise<void>
}) {
  if (part.toolName === "question") {
    return (
      <QuestionToolView
        part={part}
        interactive={interactive}
        onSubmitAnswers={
          onAnswerTool
            ? async (answers: QuestionAnswers) => {
                await onAnswerTool(part.toolCallId, part.toolName, answers)
              }
            : undefined
        }
      />
    )
  }

  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Tool · {part.toolName} · {part.state}
      </div>
      {part.state === "output-available" ? (
        <pre className="mt-2 max-h-40 overflow-auto text-xs whitespace-pre-wrap">
          {typeof part.output === "string"
            ? part.output
            : JSON.stringify(part.output, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}
