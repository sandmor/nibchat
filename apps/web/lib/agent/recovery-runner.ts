import "server-only"
import {
  reconcileChatGenerationRuns,
  repairOrphanedAgentRuns,
} from "@/lib/chat-service"
import { db, migrate } from "@/lib/db"
import { logDiagnosticFailure } from "@/lib/diagnostics"

const TICK_MS = 30_000
const globalForRecovery = globalThis as typeof globalThis & {
  nibchatAgentRecoveryRunner?: { stop: () => void }
}

/** Resume interrupted helper trees after server startup, including unopened chats. */
export function startAgentRecoveryRunner() {
  globalForRecovery.nibchatAgentRecoveryRunner?.stop()
  let running = false
  let migrated = false
  let repairPending: string[] | null = null
  const tick = () => {
    if (running) return
    running = true
    void (async () => {
      if (!migrated) {
        await migrate()
        migrated = true
      }
      const active = await db
        .selectFrom("generation_runs")
        .innerJoin("chats", "chats.id", "generation_runs.chat_id")
        .select([
          "generation_runs.chat_id as chatId",
          "generation_runs.node_id as nodeId",
          "chats.kind as chatKind",
        ])
        .where("generation_runs.state", "in", [
          "starting",
          "active",
          "recovering",
          "cancel_requested",
        ])
        .execute()
      for (const row of active) {
        if (row.chatKind !== "agent_run") {
          const invocation = await db
            .selectFrom("helper_task_invocations")
            .select("tool_call_id")
            .where("parent_node_id", "=", row.nodeId)
            .executeTakeFirst()
          if (!invocation) continue
        }
        await reconcileChatGenerationRuns(row.chatId)
      }
      if (repairPending === null || repairPending.length)
        repairPending = await repairOrphanedAgentRuns(
          repairPending ?? undefined
        )
    })()
      .catch((error) =>
        logDiagnosticFailure("agent.recovery_runner_failed", error)
      )
      .finally(() => {
        running = false
      })
  }
  tick()
  const timer = setInterval(tick, TICK_MS)
  timer.unref?.()
  const handle = {
    stop: () => {
      clearInterval(timer)
      if (globalForRecovery.nibchatAgentRecoveryRunner === handle)
        globalForRecovery.nibchatAgentRecoveryRunner = undefined
    },
  }
  globalForRecovery.nibchatAgentRecoveryRunner = handle
}
