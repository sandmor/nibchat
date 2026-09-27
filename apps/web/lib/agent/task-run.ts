import "server-only"
import { continueChatGeneration } from "@/lib/agent/open-generation"
import { listHelperProfiles } from "@/lib/agent/helper-profiles"
import { taskProgressPart, type TaskToolContext } from "@/lib/agent/tools/task"
import {
  CONTINUE_TASK_TOOL_NAME,
  type TaskInput,
  type ContinueTaskInput,
  type TaskProgress,
  type TaskToolOutput,
} from "@/lib/agent/tools/task-shared"
import type { GenerationSettled } from "@/lib/agent/generation-options"
import {
  createMessage,
  deleteChat,
  deleteNode,
  listChatContextBooks,
  prepareChatRow,
  reconcileChatGenerationRuns,
  resolveSettingsForChat,
} from "@/lib/chat-service"
import { db } from "@/lib/db"
import { ancestorPath, parseJson, resolveActivePath } from "@/lib/domain"
import { pendingToolInvocations, textFromParts } from "@/lib/agent/parts"
import { defaultPromptStack, readStackJson } from "@/lib/prompt-stack"
import { modelConfigToSettingValues } from "@/lib/chat-settings"
import { getAgentLimits } from "@/lib/user-settings"
import { TITLE_MAX_CHARS } from "@/lib/chat-title"
import { MAX_PROMPT_CHARS } from "@/lib/limits"
import {
  GENERATION_ATTACH_POLL_MS,
  GENERATION_STARTING_HANDOFF_MS,
} from "@/lib/generation-streams/policy"
import { taskDepth } from "@/lib/agent/task-depth"
import type { ChatRow, Parts } from "@/lib/types"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function previewThrottle(publish: (text: string) => void) {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: string | null = null
  const flush = (value: string) => {
    last = Date.now()
    pending = null
    publish(value.slice(-500))
  }
  return {
    push(text: string) {
      const nowMs = Date.now()
      if (nowMs - last >= 250) {
        if (timer) clearTimeout(timer)
        timer = null
        flush(text)
      } else {
        pending = text
        if (!timer)
          timer = setTimeout(
            () => {
              timer = null
              if (pending !== null) flush(pending)
            },
            250 - (nowMs - last)
          )
      }
    },
    stop() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}

async function loadOwnedChat(userId: string, chatId: string) {
  const chat = await db
    .selectFrom("chats")
    .selectAll()
    .where("id", "=", chatId)
    .where("user_id", "=", userId)
    .executeTakeFirst()
  if (!chat) throw new Error("Chat not found")
  return chat
}

async function rootNodeId(
  userId: string,
  parentChatId: string,
  parentNodeId: string
) {
  const parent = await loadOwnedChat(userId, parentChatId)
  if (parent.kind !== "agent_run") return parentNodeId
  const snapshot = parseJson<{ rootNodeId?: string }>(
    parent.agent_config_json ?? "{}",
    {}
  )
  return snapshot.rootNodeId ?? parent.parent_node_id ?? parentNodeId
}

export async function reserveInvocation(
  rootNodeId: string,
  parentNodeId: string,
  toolCallId: string,
  inputJson: string,
  generationId?: string
) {
  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom("helper_task_invocations")
      .selectAll()
      .where("tool_call_id", "=", toolCallId)
      .where("parent_node_id", "=", parentNodeId)
      .executeTakeFirst()
    const parent = await trx
      .selectFrom("message_nodes")
      .select("parts_json")
      .where("id", "=", parentNodeId)
      .executeTakeFirst()
    const recorded = new Set(
      parseJson<Parts>(parent?.parts_json ?? "[]", []).flatMap((part) =>
        part.type === "tool-invocation" &&
        (part.state === "output-available" || part.state === "output-error")
          ? [part.toolCallId]
          : []
      )
    )
    const candidates = existing
      ? []
      : await trx
          .selectFrom("helper_task_invocations")
          .selectAll()
          .where("parent_node_id", "=", parentNodeId)
          .where("input_json", "=", inputJson)
          .execute()
    let matching = existing
    if (!matching)
      for (const candidate of candidates) {
        if (recorded.has(candidate.tool_call_id)) continue
        if (generationId && candidate.generation_id === generationId) continue
        const claimed = await trx
          .updateTable("helper_task_invocations")
          .set({ replay_claim_id: toolCallId })
          .where("parent_node_id", "=", parentNodeId)
          .where("tool_call_id", "=", candidate.tool_call_id)
          .where("replay_claim_id", "is", null)
          .executeTakeFirst()
        if (Number(claimed.numUpdatedRows ?? 0) > 0) {
          matching = candidate
          break
        }
      }
    if (matching) {
      return {
        existing: true as const,
        toolCallId: matching.tool_call_id,
        chatId: matching.chat_id,
        resultJson: matching.result_json,
      }
    }
    await trx
      .insertInto("helper_task_invocations")
      .values({
        tool_call_id: toolCallId,
        parent_node_id: parentNodeId,
        root_node_id: rootNodeId,
        chat_id: null,
        input_json: inputJson,
        result_json: null,
        created_at: new Date().toISOString(),
        replay_claim_id: null,
        generation_id: generationId ?? null,
      })
      .execute()
    return {
      existing: false as const,
      toolCallId,
      chatId: null,
      resultJson: null,
    }
  })
}

function copyParts(parts: Parts): Parts {
  const result: Parts = []
  for (const part of parts) {
    if (part.type === "text") result.push({ type: "text", text: part.text })
    if (part.type === "attachment") result.push(part)
    if (part.type === "tool-invocation" && part.state === "output-available")
      result.push({
        type: "text",
        text: `Tool ${part.toolName}: ${JSON.stringify(part.output).slice(0, MAX_PROMPT_CHARS)}`,
      })
  }
  return result
}

async function copyConversation(input: {
  userId: string
  parentChatId: string
  parentNodeId: string
  childChatId: string
}) {
  const current = await db
    .selectFrom("message_nodes")
    .select(["parent_id"])
    .where("id", "=", input.parentNodeId)
    .where("chat_id", "=", input.parentChatId)
    .executeTakeFirst()
  if (!current) throw new Error("Parent message not found")
  if (!current.parent_id) return null
  const nodes = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("chat_id", "=", input.parentChatId)
    .execute()
  let previous: string | null = null
  for (const node of ancestorPath(nodes, current.parent_id)) {
    if (
      node.excluded_from_context ||
      node.status === "streaming" ||
      (node.status === "error" && !node.search_text) ||
      (node.role !== "user" && node.role !== "assistant")
    )
      continue
    const parts = copyParts(parseJson<Parts>(node.parts_json, []))
    if (parts.length === 0) continue
    const copy = await createMessage({
      userId: input.userId,
      chatId: input.childChatId,
      parentId: previous,
      role: node.role,
      parts,
      attachSelection: true,
      metadata: { delegatedContext: true, sourceNodeId: node.id },
    })
    previous = copy.id
  }
  return previous
}

export async function prepareAgentRun(input: {
  userId: string
  parentChatId: string
  parentNodeId: string
  toolCallId: string
  task: TaskInput | ContinueTaskInput
}) {
  const parent = await loadOwnedChat(input.userId, input.parentChatId)
  let run: ChatRow
  let profileName: string
  if ("task_id" in input.task) {
    run = await loadOwnedChat(input.userId, input.task.task_id)
    if (run.kind !== "agent_run" || run.parent_chat_id !== parent.id)
      throw new Error("That task cannot be continued from this conversation")
    profileName =
      parseJson<{ name?: string }>(run.agent_config_json ?? "{}", {}).name ??
      "Helper"
  } else {
    const task = input.task as TaskInput
    const { agentDepth } = await getAgentLimits(input.userId)
    if ((await taskDepth(input.userId, parent.id)) >= agentDepth)
      throw new Error(`Helper depth limit (${agentDepth}) reached`)
    const profiles = await listHelperProfiles(input.userId)
    const profile = task.agent
      ? profiles.find((item) => item.key === task.agent)
      : null
    if (task.agent && !profile) throw new Error("Helper not found")
    profileName = profile?.name ?? "Helper"
    const stackRow = profile
      ? await db
          .selectFrom("prompt_stacks")
          .select("stack_json")
          .where("id", "=", profile.promptStackId)
          .where("user_id", "=", input.userId)
          .executeTakeFirst()
      : null
    if (profile && !stackRow) throw new Error("Helper prompt stack not found")
    const stack = stackRow
      ? readStackJson(stackRow.stack_json)
      : defaultPromptStack()
    if (!profile) {
      const system = stack.modules.find((module) => module.kind === "prompt")
      if (system?.kind === "prompt")
        system.body =
          "You are a helper completing a focused assignment for another assistant. " +
          "Use the supplied context and available tools. Return the findings needed by the parent assistant, " +
          "state material uncertainty, and identify missing information.\n\n{{contextEntries}}"
    }
    const parentSettings = await resolveSettingsForChat(parent, input.userId)
    const model = {
      ...parentSettings.effective.model,
      ...(profile?.model ?? {}),
    }
    const contextMode = task.context ?? profile?.contextMode ?? "conversation"
    const books =
      contextMode === "conversation"
        ? await listChatContextBooks(input.userId, parent.id)
        : []
    const preparedChat = await prepareChatRow(
      input.userId,
      task.prompt.slice(0, TITLE_MAX_CHARS),
      modelConfigToSettingValues(model),
      parent.space_id
    )
    const resolvedChild = await resolveSettingsForChat(
      preparedChat,
      input.userId
    )
    const snapshot = {
      profileId: profile?.id ?? null,
      name: profileName,
      stack,
      model: resolvedChild.effective.model,
      mcpMode: profile?.mcpMode ?? "inherit",
      allowTask: profile?.allowTask ?? true,
      contextMode,
      rootNodeId: await rootNodeId(input.userId, parent.id, input.parentNodeId),
    }
    run = {
      ...preparedChat,
      kind: "agent_run",
      parent_chat_id: parent.id,
      parent_node_id: input.parentNodeId,
      parent_tool_call_id: input.toolCallId,
      agent_config_json: JSON.stringify(snapshot),
    }
    await db.transaction().execute(async (trx) => {
      // Serialize with parent-node deletion so a task-only helper cannot be
      // inserted after its owning message has been removed.
      await trx
        .updateTable("chats")
        .set((eb) => ({ updated_at: eb.ref("updated_at") }))
        .where("id", "=", parent.id)
        .where("user_id", "=", input.userId)
        .execute()
      const owner = await trx
        .selectFrom("message_nodes")
        .select("id")
        .where("id", "=", input.parentNodeId)
        .where("chat_id", "=", parent.id)
        .executeTakeFirst()
      if (!owner) throw new Error("Parent message no longer exists")
      await trx.insertInto("chats").values(run).execute()
      if (books.length)
        await trx
          .insertInto("chat_context_books")
          .values(
            books.map((bookId, position) => ({
              chat_id: run.id,
              context_book_id: bookId,
              position,
            }))
          )
          .execute()
    })
    try {
      if (contextMode === "conversation")
        await copyConversation({
          userId: input.userId,
          parentChatId: parent.id,
          parentNodeId: input.parentNodeId,
          childChatId: run.id,
        })
    } catch (error) {
      await deleteChat(input.userId, run.id)
      throw error
    }
  }
  const nodes = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("chat_id", "=", run.id)
    .execute()
  const path = resolveActivePath(nodes, run.selected_root_node_id)
  if ("task_id" in input.task) {
    const lastAssistant = [...path]
      .reverse()
      .find((node) => node.role === "assistant")
    const active = await db
      .selectFrom("generation_runs")
      .select("id")
      .where("chat_id", "=", run.id)
      .executeTakeFirst()
    if (
      active ||
      lastAssistant?.status === "streaming" ||
      lastAssistant?.status === "awaiting_input"
    )
      throw new Error("This helper is still working on its current task")
    if (
      !lastAssistant ||
      lastAssistant.status === "stopped" ||
      lastAssistant.status === "error"
    )
      throw new Error("This helper did not complete its previous task")
    if (
      lastAssistant &&
      !textFromParts(parseJson<Parts>(lastAssistant.parts_json, [])).trim()
    )
      throw new Error(
        "This helper returned no final answer. Use another helper or a narrower task."
      )
  }
  const parentId = path.at(-1)?.id ?? null
  const user = await createMessage({
    userId: input.userId,
    chatId: run.id,
    parentId,
    role: "user",
    parts: [{ type: "text", text: input.task.prompt }],
    attachSelection: true,
  })
  return {
    run,
    user,
    profileName,
    allowTask:
      parseJson<{ allowTask?: boolean }>(run.agent_config_json ?? "{}", {})
        .allowTask !== false,
  }
}

function resultText(
  settled: GenerationSettled,
  taskId: string
): TaskToolOutput {
  const text = textFromParts(settled.parts).trim()
  const answer =
    text.length > MAX_PROMPT_CHARS
      ? `${text.slice(0, MAX_PROMPT_CHARS)}\n[Answer truncated; open the task chat for the full reply.]`
      : text
  if (settled.outcome === "complete" && !answer)
    return {
      task_id: taskId,
      status: "error",
      answer: "",
      error: "The helper finished without a final answer.",
    }
  if (settled.outcome === "complete")
    return {
      task_id: taskId,
      status: "completed",
      answer,
    }
  if (settled.outcome === "aborted")
    return {
      task_id: taskId,
      status: "stopped",
      answer: answer || "The helper was stopped.",
    }
  return {
    task_id: taskId,
    status: "error",
    answer,
    error:
      settled.outcome === "awaiting_input"
        ? "The helper paused for user input. Ask the user directly."
        : "The helper failed.",
  }
}

async function claimQueuedMessageOrSave(input: {
  parentNodeId: string
  toolCallId: string
  chatId: string
  output: TaskToolOutput
}) {
  return db.transaction().execute(async (trx) => {
    const held = await trx
      .updateTable("helper_task_invocations")
      .set({ result_json: null })
      .where("parent_node_id", "=", input.parentNodeId)
      .where("tool_call_id", "=", input.toolCallId)
      .where("result_json", "is", null)
      .executeTakeFirst()
    if (Number(held.numUpdatedRows ?? 0) < 1) return null
    const queued = await trx
      .selectFrom("helper_task_messages")
      .selectAll()
      .where("chat_id", "=", input.chatId)
      .where("delivered_at", "is", null)
      .orderBy("created_at")
      .executeTakeFirst()
    if (queued) {
      await trx
        .updateTable("helper_task_messages")
        .set({ claimed_at: new Date().toISOString() })
        .where("id", "=", queued.id)
        .execute()
      return queued
    }
    await trx
      .updateTable("helper_task_invocations")
      .set({ result_json: JSON.stringify(input.output) })
      .where("parent_node_id", "=", input.parentNodeId)
      .where("tool_call_id", "=", input.toolCallId)
      .execute()
    return null
  })
}

async function deliverQueuedMessage(input: {
  userId: string
  chatId: string
  queueId: string
  content: string
}) {
  const nodes = await db
    .selectFrom("message_nodes")
    .selectAll()
    .where("chat_id", "=", input.chatId)
    .execute()
  const existing = nodes.find((node) => {
    const metadata = parseJson<{ queuedTaskMessageId?: string }>(
      node.metadata_json,
      {}
    )
    return metadata.queuedTaskMessageId === input.queueId
  })
  const chat = await loadOwnedChat(input.userId, input.chatId)
  const path = resolveActivePath(nodes, chat.selected_root_node_id)
  const user =
    existing ??
    (await createMessage({
      userId: input.userId,
      chatId: input.chatId,
      parentId: path.at(-1)?.id ?? null,
      role: "user",
      parts: [{ type: "text", text: input.content }],
      attachSelection: true,
      metadata: { queuedTaskMessageId: input.queueId },
    }))
  await db
    .updateTable("helper_task_messages")
    .set({ delivered_at: new Date().toISOString() })
    .where("id", "=", input.queueId)
    .execute()
  return user.id
}

async function waitForQuestionAnswer(input: {
  chatId: string
  signal: AbortSignal
  progress: (
    state: TaskProgress["state"],
    preview: string,
    question?: TaskProgress["question"]
  ) => Promise<void>
}): Promise<GenerationSettled> {
  let announced = false
  while (!input.signal.aborted) {
    const assistant = await db
      .selectFrom("message_nodes")
      .select(["id", "status", "parts_json"])
      .where("chat_id", "=", input.chatId)
      .where("role", "=", "assistant")
      .orderBy("created_at", "desc")
      .executeTakeFirst()
    if (!assistant) return { outcome: "error", parts: [] }
    const parts = parseJson<Parts>(assistant.parts_json, [])
    if (assistant.status === "complete") return { outcome: "complete", parts }
    if (assistant.status === "stopped") return { outcome: "aborted", parts }
    if (assistant.status === "error") return { outcome: "error", parts }
    if (assistant.status === "awaiting_input" && !announced) {
      announced = true
      await input.progress(
        "awaiting_input",
        "The helper has a question.",
        (() => {
          const part = pendingToolInvocations(parts).find(
            (item) => item.toolName === "question"
          )
          return part ? { assistantNodeId: assistant.id, part } : undefined
        })()
      )
    }
    if (assistant.status === "streaming") announced = false
    await new Promise<void>((resolve) =>
      setTimeout(resolve, GENERATION_ATTACH_POLL_MS)
    )
  }
  return { outcome: "aborted", parts: [] }
}

export async function runAgentTask(input: {
  context: TaskToolContext
  toolCallId: string
  input: TaskInput | ContinueTaskInput
}): Promise<TaskToolOutput> {
  const toolName = "task_id" in input.input ? CONTINUE_TASK_TOOL_NAME : "task"
  return (async () => {
    if (input.context.abortSignal.aborted)
      return {
        task_id: "task_id" in input.input ? input.input.task_id : "",
        status: "stopped",
        answer: "The chat was stopped.",
      }
    const root = await rootNodeId(
      input.context.userId,
      input.context.parentChatId,
      input.context.parentNodeId
    )
    const reservation = await reserveInvocation(
      root,
      input.context.parentNodeId,
      input.toolCallId,
      JSON.stringify(input.input),
      input.context.generationId
    )
    const abortSignal = input.context.abortSignal
    const saveResult = async (output: TaskToolOutput) => {
      await db
        .updateTable("helper_task_invocations")
        .set({ result_json: JSON.stringify(output) })
        .where("parent_node_id", "=", input.context.parentNodeId)
        .where("tool_call_id", "=", reservation.toolCallId)
        .execute()
      return output
    }
    if (reservation.existing) {
      if (reservation.resultJson)
        return JSON.parse(reservation.resultJson) as TaskToolOutput
      let announcedQuestion = ""
      let announcedRun = false
      while (!abortSignal.aborted) {
        const row = await db
          .selectFrom("helper_task_invocations")
          .select(["chat_id", "result_json", "created_at"])
          .where("parent_node_id", "=", input.context.parentNodeId)
          .where("tool_call_id", "=", reservation.toolCallId)
          .executeTakeFirst()
        if (!row)
          return {
            task_id: "",
            status: "error",
            answer: "",
            error: "The original helper call was removed.",
          }
        if (row.result_json)
          return JSON.parse(row.result_json) as TaskToolOutput
        if (!row.chat_id) {
          const child = await db
            .selectFrom("chats")
            .select("id")
            .where("parent_node_id", "=", input.context.parentNodeId)
            .where("parent_tool_call_id", "=", reservation.toolCallId)
            .where("user_id", "=", input.context.userId)
            .executeTakeFirst()
          if (child) {
            await db
              .updateTable("helper_task_invocations")
              .set({ chat_id: child.id })
              .where("parent_node_id", "=", input.context.parentNodeId)
              .where("tool_call_id", "=", reservation.toolCallId)
              .where("chat_id", "is", null)
              .execute()
            continue
          }
          const age = Date.now() - Date.parse(row.created_at || "1970-01-01")
          if (age > GENERATION_STARTING_HANDOFF_MS) {
            const output: TaskToolOutput = {
              task_id: "",
              status: "error",
              answer: "",
              error:
                "The helper stopped before its chat was created. Try the task again.",
            }
            const changed = await db
              .updateTable("helper_task_invocations")
              .set({ result_json: JSON.stringify(output) })
              .where("parent_node_id", "=", input.context.parentNodeId)
              .where("tool_call_id", "=", reservation.toolCallId)
              .where("chat_id", "is", null)
              .where("result_json", "is", null)
              .executeTakeFirst()
            if (Number(changed.numUpdatedRows ?? 0) > 0) return output
          }
        }
        if (row.chat_id) {
          await reconcileChatGenerationRuns(row.chat_id)
          const child = await loadOwnedChat(input.context.userId, row.chat_id)
          const helper =
            parseJson<{ name?: string }>(child.agent_config_json ?? "{}", {})
              .name ?? "Helper"
          if (!announcedRun) {
            announcedRun = true
            await input.context.publish(
              taskProgressPart(
                input.toolCallId,
                input.input,
                {
                  runId: child.id,
                  helper,
                  description: input.input.prompt.slice(0, TITLE_MAX_CHARS),
                  state: "running",
                  preview: "Resuming helper…",
                },
                toolName
              )
            )
          }
          const nodes = await db
            .selectFrom("message_nodes")
            .selectAll()
            .where("chat_id", "=", child.id)
            .execute()
          const hasAssignment = nodes.some(
            (node) =>
              node.role === "user" &&
              !parseJson<{ delegatedContext?: boolean }>(node.metadata_json, {})
                .delegatedContext
          )
          if (
            !hasAssignment &&
            Date.now() - Date.parse(child.created_at) >
              GENERATION_STARTING_HANDOFF_MS
          ) {
            await deleteChat(input.context.userId, child.id)
            return saveResult({
              task_id: "",
              status: "error",
              answer: "",
              error:
                "The helper stopped before its assignment was saved. Try the task again.",
            })
          }
          if (!hasAssignment) {
            await new Promise<void>((resolve) =>
              setTimeout(resolve, GENERATION_ATTACH_POLL_MS)
            )
            continue
          }
          const path = resolveActivePath(nodes, child.selected_root_node_id)
          const latest = path.at(-1)
          const parts =
            latest?.role === "assistant"
              ? parseJson<Parts>(latest.parts_json, [])
              : []
          if (
            latest?.role === "user" &&
            !parseJson<{
              delegatedContext?: boolean
              queuedTaskMessageId?: string
            }>(latest.metadata_json, {}).queuedTaskMessageId
          ) {
            try {
              await continueChatGeneration({
                userId: input.context.userId,
                chatId: child.id,
                parentId: latest.id,
                timeZone: input.context.timeZone,
                attachSelection: true,
                agent: { externalAbort: abortSignal },
              })
            } catch (error) {
              return saveResult({
                task_id: child.id,
                status: "error",
                answer: "",
                error:
                  error instanceof Error
                    ? error.message
                    : "Helper restart failed",
              })
            }
            continue
          }
          if (
            latest?.role === "user" &&
            parseJson<{ queuedTaskMessageId?: string }>(
              latest.metadata_json,
              {}
            ).queuedTaskMessageId
          ) {
            try {
              await continueChatGeneration({
                userId: input.context.userId,
                chatId: child.id,
                parentId: latest.id,
                timeZone: input.context.timeZone,
                attachSelection: true,
                agent: { externalAbort: abortSignal },
              })
            } catch (error) {
              return saveResult({
                task_id: child.id,
                status: "error",
                answer: "",
                error:
                  error instanceof Error ? error.message : "Follow-up failed",
              })
            }
            continue
          }
          if (latest?.role === "assistant" && latest.status === "complete") {
            const output = resultText({ outcome: "complete", parts }, child.id)
            const queued = await claimQueuedMessageOrSave({
              parentNodeId: input.context.parentNodeId,
              toolCallId: reservation.toolCallId,
              chatId: child.id,
              output,
            })
            if (!queued) return output
            const nextUserId = await deliverQueuedMessage({
              userId: input.context.userId,
              chatId: child.id,
              queueId: queued.id,
              content: queued.content,
            })
            await input.context.publish(
              taskProgressPart(
                input.toolCallId,
                input.input,
                {
                  runId: child.id,
                  helper,
                  description: input.input.prompt.slice(0, TITLE_MAX_CHARS),
                  state: "running",
                  preview: "Following up on your message…",
                },
                toolName
              )
            )
            try {
              await continueChatGeneration({
                userId: input.context.userId,
                chatId: child.id,
                parentId: nextUserId,
                timeZone: input.context.timeZone,
                attachSelection: true,
                agent: {
                  externalAbort: abortSignal,
                  onLiveText: (text) => {
                    void input.context
                      .publish(
                        taskProgressPart(
                          input.toolCallId,
                          input.input,
                          {
                            runId: child.id,
                            helper,
                            description: input.input.prompt.slice(
                              0,
                              TITLE_MAX_CHARS
                            ),
                            state: "running",
                            preview: text.slice(-500),
                          },
                          toolName
                        )
                      )
                      .catch(() => {})
                  },
                },
              })
            } catch (error) {
              return saveResult({
                task_id: child.id,
                status: "error",
                answer: "",
                error:
                  error instanceof Error ? error.message : "Follow-up failed",
              })
            }
            continue
          }
          if (latest?.role === "assistant" && latest.status === "stopped")
            return saveResult(
              resultText({ outcome: "aborted", parts }, child.id)
            )
          if (latest?.role === "assistant" && latest.status === "error")
            return saveResult(resultText({ outcome: "error", parts }, child.id))
          const question =
            latest?.role === "assistant" && latest.status === "awaiting_input"
              ? pendingToolInvocations(parts).find(
                  (part) => part.toolName === "question"
                )
              : undefined
          if (question && announcedQuestion !== question.toolCallId) {
            announcedQuestion = question.toolCallId
            await input.context.publish(
              taskProgressPart(
                input.toolCallId,
                input.input,
                {
                  runId: child.id,
                  helper,
                  description: input.input.prompt.slice(0, TITLE_MAX_CHARS),
                  state: "awaiting_input",
                  preview: "The helper has a question.",
                  question: { assistantNodeId: latest!.id, part: question },
                },
                toolName
              )
            )
          }
        }
        await new Promise<void>((resolve) =>
          setTimeout(resolve, GENERATION_ATTACH_POLL_MS)
        )
      }
      return {
        task_id: reservation.chatId ?? "",
        status: "stopped",
        answer: "The chat was stopped.",
      }
    }
    let prepared: Awaited<ReturnType<typeof prepareAgentRun>>
    try {
      prepared = await prepareAgentRun({
        userId: input.context.userId,
        parentChatId: input.context.parentChatId,
        parentNodeId: input.context.parentNodeId,
        toolCallId: input.toolCallId,
        task: input.input,
      })
    } catch (error) {
      await db
        .deleteFrom("helper_task_invocations")
        .where("tool_call_id", "=", input.toolCallId)
        .where("parent_node_id", "=", input.context.parentNodeId)
        .execute()
      throw error
    }
    if (abortSignal.aborted) {
      if ("task_id" in input.input)
        await deleteNode(input.context.userId, prepared.user.id, "subtree")
      else await deleteChat(input.context.userId, prepared.run.id)
      return saveResult({
        task_id: "task_id" in input.input ? prepared.run.id : "",
        status: "stopped",
        answer: "The chat was stopped.",
      })
    }
    await db
      .updateTable("helper_task_invocations")
      .set({ chat_id: prepared.run.id })
      .where("tool_call_id", "=", input.toolCallId)
      .where("parent_node_id", "=", input.context.parentNodeId)
      .execute()
    let finished = false
    const progress = (
      state: TaskProgress["state"],
      preview: string,
      question?: TaskProgress["question"]
    ) => {
      if (finished) return Promise.resolve()
      return input.context.publish(
        taskProgressPart(
          input.toolCallId,
          input.input,
          {
            runId: prepared.run.id,
            helper: prepared.profileName,
            description: input.input.prompt.slice(0, TITLE_MAX_CHARS),
            state,
            preview,
            ...(question ? { question } : {}),
          },
          toolName
        )
      )
    }
    await progress("running", "")
    const preview = previewThrottle((text) => {
      void progress("running", text).catch(() => {})
    })
    let parentId = prepared.user.id
    for (;;) {
      const done = deferred<GenerationSettled>()
      let settled: GenerationSettled | null = null
      try {
        await continueChatGeneration({
          userId: input.context.userId,
          chatId: prepared.run.id,
          parentId,
          timeZone: input.context.timeZone,
          attachSelection: true,
          agent: {
            toolPolicy: {
              question: true,
              task: prepared.allowTask,
              mcp:
                parseJson<{ mcpMode?: "inherit" | "none" }>(
                  prepared.run.agent_config_json ?? "{}",
                  {}
                ).mcpMode ?? "inherit",
            },
            externalAbort: abortSignal,
            onLiveText: preview.push,
            whenSettled: (value) => {
              settled = value
              done.resolve(value)
            },
          },
        })
      } catch (error) {
        if (!settled) {
          finished = true
          preview.stop()
          return saveResult({
            task_id: prepared.run.id,
            status: "error",
            answer: "",
            error:
              error instanceof Error
                ? error.message
                : "The helper failed to start.",
          })
        }
      }
      let terminal = settled ?? (await done.promise)
      if (terminal.outcome === "awaiting_input") {
        preview.stop()
        terminal = await waitForQuestionAnswer({
          chatId: prepared.run.id,
          signal: abortSignal,
          progress,
        })
      }
      if (terminal.outcome !== "complete") {
        finished = true
        preview.stop()
        return saveResult(resultText(terminal, prepared.run.id))
      }
      const output = resultText(terminal, prepared.run.id)
      const queued = await claimQueuedMessageOrSave({
        parentNodeId: input.context.parentNodeId,
        toolCallId: reservation.toolCallId,
        chatId: prepared.run.id,
        output,
      })
      if (!queued) {
        finished = true
        preview.stop()
        return output
      }
      parentId = await deliverQueuedMessage({
        userId: input.context.userId,
        chatId: prepared.run.id,
        queueId: queued.id,
        content: queued.content,
      })
      await progress("running", "Following up on your message…")
    }
  })()
}
