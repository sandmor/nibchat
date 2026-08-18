"use client"

import * as React from "react"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire"
import {
  questionInputSchema,
  type QuestionAnswers,
  type QuestionInput,
  type QuestionPrompt,
} from "@/lib/agent/tools/question-shared"
import type { ToolInvocationPart } from "@/lib/types"

function answersFromOutput(output: unknown): QuestionAnswers | null {
  if (output && typeof output === "object" && "metadata" in output) {
    const meta = (output as { metadata?: { answers?: unknown } }).metadata
    if (meta && Array.isArray(meta.answers))
      return meta.answers as QuestionAnswers
  }
  if (Array.isArray(output)) return output as QuestionAnswers
  return null
}

function parseInput(input: unknown): QuestionInput | null {
  const parsed = questionInputSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

function PreparingQuestions() {
  return (
    <div
      data-find-skip
      className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
    >
      Preparing questions…
    </div>
  )
}

export function QuestionToolView({
  part,
  interactive,
  onSubmitAnswers,
}: {
  part: ToolInvocationPart
  interactive: boolean
  onSubmitAnswers?: (answers: QuestionAnswers) => void | Promise<void>
}) {
  const data = parseInput(part.input)
  const locked = answersFromOutput(part.output)
  const [submitting, setSubmitting] = React.useState(false)

  // Arguments stream in over multiple chunks; empty/partial input is expected.
  if (
    part.state === "input-streaming" ||
    (!data && part.state !== "input-available")
  ) {
    return <PreparingQuestions />
  }

  if (!data) {
    return (
      <div
        data-find-skip
        className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
      >
        Invalid question tool input.
      </div>
    )
  }

  if (
    part.state === "output-available" ||
    part.state === "output-error" ||
    (locked && !interactive)
  ) {
    return (
      <QuestionAnswersSummary
        questions={data.questions}
        answers={locked}
        error={part.state === "output-error" ? part.errorText : undefined}
      />
    )
  }

  if (!interactive) {
    return (
      <div
        data-find-skip
        className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
      >
        Waiting for answers…
      </div>
    )
  }

  // Spec allows unanswered (empty arrays → Unanswered); every item is optional.
  const items = data.questions.map((q, index) => ({
    name: `q${index}`,
    required: false as const,
    prompt: q.question,
    description: q.header,
    multiple: q.multiple,
    custom: q.custom !== false,
    choices: q.options.map((o) => ({
      value: o.label,
      label: o.label,
      description: o.description,
    })),
  }))

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onSubmitAnswers || submitting) return
    const form = new FormData(event.currentTarget)
    const answers: QuestionAnswers = data!.questions.map((question, index) => {
      const name = `q${index}`
      if (question.multiple) {
        return form
          .getAll(name)
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean)
      }
      const single = String(form.get(name) ?? "").trim()
      return single ? [single] : []
    })
    setSubmitting(true)
    try {
      await onSubmitAnswers(answers)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <Questionnaire items={items} onSubmit={handleSubmit}>
        <div data-find-skip>
          <QuestionnaireProgress />
        </div>
        {items.map((question, index) => {
          return (
            <QuestionnaireItem
              key={question.name}
              name={question.name}
              required={question.required}
              multiple={question.multiple}
            >
              <QuestionnaireTitle>{question.prompt}</QuestionnaireTitle>
              <QuestionnaireDescription>
                {question.description}
              </QuestionnaireDescription>
              <QuestionnaireChoices>
                {question.choices.map((choice) => (
                  <QuestionnaireChoice key={choice.value} value={choice.value}>
                    <span className="font-medium">{choice.label}</span>
                    {choice.description ? (
                      <span className="text-muted-foreground">
                        {choice.description}
                      </span>
                    ) : null}
                  </QuestionnaireChoice>
                ))}
                {question.custom ? (
                  <div data-find-skip>
                    <QuestionnaireInput
                      aria-label="Another answer"
                      placeholder="Type another answer…"
                    />
                  </div>
                ) : null}
              </QuestionnaireChoices>
              <div data-find-skip>
                <QuestionnaireError />
              </div>
            </QuestionnaireItem>
          )
        })}
        <QuestionnaireActions data-find-skip>
          <QuestionnairePrevious />
          <QuestionnaireSkip />
          <QuestionnaireNext />
          <QuestionnaireSubmit disabled={submitting}>
            {submitting ? "Submitting…" : "Submit answers"}
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </div>
  )
}

function QuestionAnswersSummary({
  questions,
  answers,
  error,
}: {
  questions: QuestionPrompt[]
  answers: QuestionAnswers | null
  error?: string
}) {
  return (
    <div className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm">
      <p
        data-find-skip
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        Questions answered
      </p>
      {error ? <p className="text-destructive">{error}</p> : null}
      <ul className="space-y-2">
        {questions.map((q, i) => {
          const selected = answers?.[i] ?? []
          return (
            <li key={i}>
              <div className="font-medium">{q.header}</div>
              <div className="text-muted-foreground">
                {selected.length === 0 ? "Unanswered" : selected.join(", ")}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
