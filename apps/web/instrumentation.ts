export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.GENERATION_RUNTIME_MODE === "stateless") return
  const { startScheduleRunner } = await import("@/lib/schedules/runner")
  startScheduleRunner()
}
