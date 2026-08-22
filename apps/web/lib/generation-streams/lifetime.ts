import "server-only"
import { after } from "next/server"
import type { GenerationLifetimePort } from "@/lib/generation-streams/ports"

class StatefulLifetimePort implements GenerationLifetimePort {
  private readonly tasks = new Set<Promise<unknown>>()

  retain(task: Promise<unknown>) {
    this.tasks.add(task)
    void task.finally(() => this.tasks.delete(task))
  }
}

class StatelessLifetimePort implements GenerationLifetimePort {
  retain(task: Promise<unknown>) {
    // The task has already started. `after` keeps it alive if the response
    // closes first; it does not defer producer startup.
    after(() => task)
  }
}

export function createGenerationLifetimePort(): GenerationLifetimePort {
  return process.env.GENERATION_RUNTIME_MODE === "stateless"
    ? new StatelessLifetimePort()
    : new StatefulLifetimePort()
}
