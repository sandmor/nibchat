"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Pdf02Icon } from "@hugeicons/core-free-icons"
import { Markdown } from "@/components/markdown"
import { QuestionToolView } from "@/components/workspace/tools/question-tool"
import { ImageViewer } from "@/components/workspace/image-viewer"
import { pdfAttachmentCaption } from "@/lib/pdf-input"
import type { QuestionAnswers } from "@/lib/agent/tools/question-shared"
import { coalesceAdjacentTextParts } from "@/lib/agent/parts"
import type { Parts, ToolInvocationPart } from "@/lib/types"

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

  const coalesced = coalesceAdjacentTextParts(parts)

  return (
    <>
      <div className="flex flex-col gap-3">
        {coalesced.map((part, index) => {
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
            if (part.content.kind === "document") {
              const src = `/api/attachments/${part.content.attachmentId}`
              return (
                <figure key={part.id} className="w-fit max-w-full">
                  <a
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="flex max-w-full items-center gap-2.5 rounded-md border bg-muted/40 px-2.5 py-2 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted">
                      <HugeiconsIcon
                        icon={Pdf02Icon}
                        strokeWidth={2}
                        className="size-5 text-muted-foreground"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {part.name}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {pdfAttachmentCaption(part.content.analysis)}
                      </span>
                    </span>
                  </a>
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
