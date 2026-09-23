import "server-only"
import { schedulesAvailable, runScheduleTick } from "@/lib/schedules/service"

const TICK_MS = 30_000

const globalForSchedules = globalThis as typeof globalThis & {
  nibchatScheduleRunner?: { stop: () => void }
}

/** Poll due schedules on a long-lived Node process. Stateless mode does not start. */
export function startScheduleRunner() {
  if (!schedulesAvailable()) return
  globalForSchedules.nibchatScheduleRunner?.stop()
  let running = false
  const tick = () => {
    if (running) return
    running = true
    void runScheduleTick()
      .catch((error) => {
        console.error("[nibchat/schedules]", error)
      })
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
      if (globalForSchedules.nibchatScheduleRunner === handle)
        globalForSchedules.nibchatScheduleRunner = undefined
    },
  }
  globalForSchedules.nibchatScheduleRunner = handle
}
