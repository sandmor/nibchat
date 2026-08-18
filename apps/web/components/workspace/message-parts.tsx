"use client"

import { useState } from "react"
import { Markdown } from "@/components/markdown"
import { QuestionToolView } from "@/components/workspace/tools/question-tool"
import { ImageViewer } from "@/components/workspace/image-viewer"
import type { QuestionAnswers } from "@/lib/agent/tools/question-shared"
import type { Part, Parts, ToolInvocationPart } from "@/lib/types"

type RenderPart = { part: Part; index: number }

/** Text deltas belong to one Markdown document until another part intervenes. */
function coalesceAdjacentTextParts(parts: Parts): RenderPart[] {
  const result: RenderPart[] = []
  for (const [index, part] of parts.entries()) {
    const previous = result.at(-1)
    if (part.type === "text" && previous?.part.type === "text") {
      previous.part = { type: "text", text: previous.part.text + part.text }
      continue
    }
    result.push({ part, index })
  }
  return result
}

export function MessageParts({
  parts,
  streaming = false,
  interactiveTools,
  onAnswerTool,
}: {
  parts: Parts
  streaming?: boolean
  /** Whether pending client tools may be answered on this message. */
  interactiveTools?: boolean
  onAnswerTool?: (
    toolCallId: string,
    toolName: string,
    output: unknown
  ) => void | Promise<void>
}) {
  const [viewer, setViewer] = useState<{ src: string; name: string } | null>(
    null
  )
  if (parts.length === 0) {
    if (streaming) {
      return <Markdown streaming>Thinking…</Markdown>
    }
    return null
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {coalesceAdjacentTextParts(parts).map(({ part, index }) => {
          if (part.type === "reasoning") {
            return (
              <details
                key={`reasoning-${index}`}
                data-find-skip
                className="rounded-lg bg-muted p-3 text-xs text-muted-foreground"
              >
                <summary className="cursor-pointer">Reasoning</summary>
                <Markdown
                  className="mt-2 text-xs"
                  streaming={streaming}
                  variant="reasoning"
                >
                  {part.text}
                </Markdown>
              </details>
            )
          }
          if (part.type === "text") {
            return (
              <Markdown key={`text-${index}`} streaming={streaming}>
                {part.text || (streaming ? "Thinking…" : "")}
              </Markdown>
            )
          }
          if (part.type === "attachment") {
            if (part.content.kind === "binary") {
              const src = `/api/attachments/${part.content.attachmentId}`
              return (
                <figure key={part.id} className="w-fit max-w-full">
                  <button
                    type="button"
                    className="block max-w-full cursor-zoom-in rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={() => setViewer({ src, name: part.name })}
                  >
                    <img
                      src={src}
                      alt={part.name}
                      className="max-h-80 max-w-full rounded-md object-contain"
                    />
                  </button>
                  <figcaption className="mt-1 text-[11px] text-muted-foreground">
                    {part.name}
                  </figcaption>
                </figure>
              )
            }
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
      <ImageViewer image={viewer} onClose={() => setViewer(null)} />
    </>
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
