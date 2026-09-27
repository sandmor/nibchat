"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { buttonVariants } from "@/components/ui/button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MetaLine } from "@/components/ui/inline-separator"
import type { ToolInvocationPart } from "@/lib/types"
import { useTRPC } from "@/lib/trpc-react"
import { QuestionToolView } from "./question-tool"
import {
  taskProgress,
  type TaskToolOutput,
} from "@/lib/agent/tools/task-shared"
import { TITLE_MAX_CHARS } from "@/lib/chat-title"

function outputOf(part: ToolInvocationPart): TaskToolOutput | null {
  const output = part.output
  if (!output || typeof output !== "object") return null
  const record = output as Record<string, unknown>
  if (typeof record.task_id !== "string" || typeof record.answer !== "string")
    return null
  if (
    record.status !== "completed" &&
    record.status !== "error" &&
    record.status !== "stopped"
  )
    return null
  return {
    task_id: record.task_id,
    status: record.status,
    answer: record.answer,
    ...(typeof record.error === "string" ? { error: record.error } : {}),
  }
}

const stateLabel = {
  running: "Running",
  awaiting_input: "Needs input",
  completed: "Done",
  stopped: "Stopped",
  error: "Error",
} as const

const taskDrafts = new Map<string, string>()
const queuedMessageAcks = new Set<string>()

export function TaskToolView({ part }: { part: ToolInvocationPart }) {
  const progress = taskProgress(part)
  const output = part.state === "output-available" ? outputOf(part) : null
  const runId = output?.task_id || progress?.runId
  const ackKey = runId ? `${runId}:${part.toolCallId}` : null
  const trpc = useTRPC()
  const [questionSubmitted, setQuestionSubmitted] = useState(false)
  const [questionError, setQuestionError] = useState("")
  const [stopPending, setStopPending] = useState(false)
  const [messageDraft, setMessageDraft] = useState(() =>
    runId ? (taskDrafts.get(runId) ?? "") : ""
  )
  const [messagePending, setMessagePending] = useState(false)
  const [messageQueued, setMessageQueued] = useState(() =>
    ackKey ? queuedMessageAcks.has(ackKey) : false
  )
  const prompt =
    part.input && typeof part.input === "object"
      ? (part.input as { prompt?: unknown }).prompt
      : undefined
  const assignment = typeof prompt === "string" ? prompt.trim() : ""
  const description =
    progress?.description ??
    (assignment ? assignment.slice(0, TITLE_MAX_CHARS) : "Task")
  const helper = progress?.helper ?? "Helper"
  const state = output?.status ?? progress?.state ?? part.state
  const preview = output?.answer ?? progress?.preview ?? ""
  const tree = useQuery({
    ...trpc.workspace.taskTree.queryOptions({ runId: runId ?? "" }),
    enabled: Boolean(runId),
    refetchInterval:
      state === "running" || state === "awaiting_input" ? 2_000 : false,
  })
  const label =
    state === "running" ||
    state === "awaiting_input" ||
    state === "completed" ||
    state === "stopped" ||
    state === "error"
      ? stateLabel[state]
      : part.state === "input-available"
        ? "Queued"
        : "Preparing"
  const error =
    part.state === "output-error" || output?.error
      ? output?.error || part.errorText || "This task could not complete."
      : ""
  const showAssignment =
    assignment.length > description.length && assignment !== description
  const eyebrow = part.toolName === "continue_task" ? "Follow-up" : "Task"
  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            data-find-skip
            className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
          >
            <MetaLine items={[eyebrow, label]} />
          </p>
          <p className="mt-1 font-medium break-words">{description}</p>
          <p className="text-xs text-muted-foreground">{helper}</p>
        </div>
        {runId ? (
          <div className="flex shrink-0 gap-1">
            <Link
              href={`/chat/${runId}`}
              data-find-skip
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open
            </Link>
            {(state === "running" || state === "awaiting_input") && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={stopPending}
                onClick={async () => {
                  setStopPending(true)
                  try {
                    const response = await fetch(`/api/agent-runs/${runId}`, {
                      method: "DELETE",
                    })
                    if (!response.ok) throw new Error("Could not stop helper")
                  } catch (error) {
                    setQuestionError(
                      error instanceof Error
                        ? error.message
                        : "Could not stop helper"
                    )
                    setStopPending(false)
                  }
                }}
              >
                Stop
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {showAssignment ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
            Full assignment
          </summary>
          <p className="mt-2 text-sm break-words whitespace-pre-wrap text-muted-foreground">
            {assignment}
          </p>
        </details>
      ) : null}
      {preview ? (
        <p className="line-clamp-6 break-words whitespace-pre-wrap text-muted-foreground">
          {preview}
        </p>
      ) : state === "running" ? (
        <p data-find-skip className="text-xs text-muted-foreground">
          Working…
        </p>
      ) : null}
      {tree.data && tree.data.length > 1 ? (
        <details className="rounded-lg border px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">
            Task tree · {tree.data.length} helpers
          </summary>
          <div className="mt-2 space-y-1">
            {tree.data.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3"
                style={{ paddingLeft: item.depth * 12 }}
              >
                <Link
                  href={`/chat/${item.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {item.title}
                </Link>
                <span className="text-muted-foreground">
                  {item.status === "awaiting_input"
                    ? "Needs input"
                    : item.status}
                  {item.tokens ? ` · ${item.tokens} tokens` : ""}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {runId && state === "running" ? (
        <form
          className="flex gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            const content = messageDraft.trim()
            if (!content || messagePending) return
            setMessagePending(true)
            setQuestionError("")
            try {
              const response = await fetch(`/api/agent-runs/${runId}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ content }),
              })
              if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as {
                  error?: string
                }
                throw new Error(body.error ?? "Could not send message")
              }
              setMessageDraft("")
              taskDrafts.delete(runId)
              if (ackKey) queuedMessageAcks.add(ackKey)
              setMessageQueued(true)
            } catch (error) {
              setQuestionError(
                error instanceof Error
                  ? error.message
                  : "Could not send message"
              )
            } finally {
              setMessagePending(false)
            }
          }}
        >
          <Input
            aria-label="Message helper"
            value={messageDraft}
            onChange={(event) => {
              setMessageDraft(event.target.value)
              taskDrafts.set(runId, event.target.value)
              if (ackKey) queuedMessageAcks.delete(ackKey)
              setMessageQueued(false)
            }}
            placeholder="Message this helper"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!messageDraft.trim() || messagePending}
          >
            Send
          </Button>
        </form>
      ) : null}
      {messageQueued && state === "running" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Message queued for the helper.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-destructive">
          {error}
        </p>
      ) : null}
      {progress?.question && runId && !output ? (
        <QuestionToolView
          part={progress.question.part}
          interactive={!questionSubmitted}
          onSubmitAnswers={async (answers) => {
            setQuestionError("")
            const response = await fetch("/api/chat/generations", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                actionId: crypto.randomUUID(),
                intent: "resume",
                chatId: runId,
                assistantNodeId: progress.question!.assistantNodeId,
                toolResults: [
                  {
                    toolCallId: progress.question!.part.toolCallId,
                    output: answers,
                  },
                ],
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              }),
            })
            if (!response.ok) {
              const body = (await response.json().catch(() => ({}))) as {
                error?: string
              }
              const message = body.error ?? "Could not send the answer"
              setQuestionError(message)
              throw new Error(message)
            }
            setQuestionSubmitted(true)
            await response.body?.cancel()
          }}
        />
      ) : null}
      {questionError ? (
        <p role="alert" className="text-destructive">
          {questionError}
        </p>
      ) : null}
    </div>
  )
}
