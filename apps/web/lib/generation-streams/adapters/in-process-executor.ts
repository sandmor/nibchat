import "server-only"
import type {
  GenerationExecutorPort,
  GenerationLifetimePort,
} from "@/lib/generation-streams/ports"
import { logDiagnosticFailure } from "@/lib/diagnostics"

/**
 * The local executor starts work in this Node process and delegates only its
 * lifetime semantics to the stateful/stateless runtime adapter. A queue-backed
 * worker can implement the same port without changing generation orchestration.
 */
export class InProcessGenerationExecutor implements GenerationExecutorPort {
  constructor(private readonly lifetime: GenerationLifetimePort) {}

  execute(input: {
    generationId: string
    nodeId: string
    run: () => Promise<void>
  }) {
    const task = input.run().catch((error) => {
      logDiagnosticFailure("generation.executor_failed", error, "error", {
        generationId: input.generationId,
      })
    })
    this.lifetime.retain(task)
  }
}
