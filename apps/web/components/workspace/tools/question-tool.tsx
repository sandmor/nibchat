"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
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
  emptyQuestionInput,
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

const editorFieldClass =
  "w-full min-w-0 resize-none rounded-none border-0 bg-transparent p-0 shadow-none outline-none focus-visible:ring-0"

function patchQuestion(
  value: QuestionInput,
  index: number,
  patch: Partial<QuestionPrompt>
): QuestionInput {
  return {
    questions: value.questions.map((item, i) =>
      i === index ? { ...item, ...patch } : item
    ),
  }
}

export function QuestionInputEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: QuestionInput
  onChange: (next: QuestionInput) => void
  disabled?: boolean
}) {
  const questions = value.questions
  return (
    <div className="grid gap-4">
      {questions.map((prompt, index) => {
        const items = [
          {
            name: `q${index}`,
            required: false as const,
          },
        ]
        return (
          <div key={index} className="rounded-xl border bg-muted/20 p-4">
            <Questionnaire
              items={items}
              onSubmit={(event) => event.preventDefault()}
            >
              <QuestionnaireItem
                name={items[0]!.name}
                required={false}
                multiple={prompt.multiple}
              >
                <QuestionnaireTitle render={<div />}>
                  <textarea
                    aria-label="Question prompt"
                    placeholder="Question"
                    rows={2}
                    disabled={disabled}
                    value={prompt.question}
                    onChange={(event) =>
                      onChange(
                        patchQuestion(value, index, {
                          question: event.target.value,
                        })
                      )
                    }
                    className={`${editorFieldClass} font-heading text-base font-semibold`}
                  />
                </QuestionnaireTitle>
                <QuestionnaireDescription render={<div />}>
                  <input
                    aria-label="Question header"
                    placeholder="Header"
                    disabled={disabled}
                    maxLength={30}
                    value={prompt.header}
                    onChange={(event) =>
                      onChange(
                        patchQuestion(value, index, {
                          header: event.target.value.slice(0, 30),
                        })
                      )
                    }
                    className={`${editorFieldClass} text-sm text-muted-foreground`}
                  />
                </QuestionnaireDescription>
                <QuestionnaireChoices>
                  {prompt.options.map((option, optionIndex) => (
                    <div key={optionIndex} className="relative">
                      <QuestionnaireChoice
                        readOnly
                        value={`q${index}-o${optionIndex}`}
                        className="pr-10"
                      >
                        <input
                          aria-label="Choice label"
                          placeholder="Option"
                          disabled={disabled}
                          value={option.label}
                          onChange={(event) =>
                            onChange(
                              patchQuestion(value, index, {
                                options: prompt.options.map((entry, j) =>
                                  j === optionIndex
                                    ? { ...entry, label: event.target.value }
                                    : entry
                                ),
                              })
                            )
                          }
                          className={`${editorFieldClass} font-medium`}
                        />
                        <QuestionnaireChoiceDescription>
                          <input
                            aria-label="Choice description"
                            placeholder="Description"
                            disabled={disabled}
                            value={option.description}
                            onChange={(event) =>
                              onChange(
                                patchQuestion(value, index, {
                                  options: prompt.options.map((entry, j) =>
                                    j === optionIndex
                                      ? {
                                          ...entry,
                                          description: event.target.value,
                                        }
                                      : entry
                                  ),
                                })
                              )
                            }
                            className={`${editorFieldClass} text-muted-foreground`}
                          />
                        </QuestionnaireChoiceDescription>
                      </QuestionnaireChoice>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute top-2.5 right-2.5 z-10 text-muted-foreground"
                        aria-label="Remove option"
                        disabled={disabled || prompt.options.length < 2}
                        onClick={() =>
                          onChange(
                            patchQuestion(value, index, {
                              options: prompt.options.filter(
                                (_, j) => j !== optionIndex
                              ),
                            })
                          )
                        }
                      >
                        ×
                      </Button>
                    </div>
                  ))}
                  {prompt.custom !== false ? (
                    <QuestionnaireInput
                      readOnly
                      tabIndex={-1}
                      aria-label="Another answer"
                      placeholder="Type another answer…"
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-start rounded-4xl border-dashed"
                    disabled={disabled}
                    onClick={() =>
                      onChange(
                        patchQuestion(value, index, {
                          options: [
                            ...prompt.options,
                            { label: "Option", description: "" },
                          ],
                        })
                      )
                    }
                  >
                    Add option
                  </Button>
                </QuestionnaireChoices>
              </QuestionnaireItem>
            </Questionnaire>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  size="sm"
                  checked={prompt.multiple === true}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(
                      patchQuestion(value, index, {
                        multiple: checked === true,
                      })
                    )
                  }
                />
                Several answers
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  size="sm"
                  checked={prompt.custom !== false}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(
                      patchQuestion(value, index, {
                        custom: checked === true,
                      })
                    )
                  }
                />
                Custom answer
              </label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="ml-auto text-muted-foreground"
                disabled={disabled || questions.length < 2}
                onClick={() =>
                  onChange({
                    questions: questions.filter((_, i) => i !== index),
                  })
                }
              >
                Remove question
              </Button>
            </div>
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() =>
          onChange({
            questions: [...questions, emptyQuestionInput().questions[0]!],
          })
        }
      >
        Add question
      </Button>
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
