import "server-only"
import { MemoryGenerationStreamPort } from "@/lib/generation-streams/adapters/memory"
import { RedisGenerationStreamPort } from "@/lib/generation-streams/adapters/redis"
import { InProcessGenerationExecutor } from "@/lib/generation-streams/adapters/in-process-executor"
import { createGenerationLifetimePort } from "@/lib/generation-streams/lifetime"
import type {
  GenerationLifetimePort,
  GenerationExecutorPort,
  GenerationStreamPort,
} from "@/lib/generation-streams/ports"

function createStore(): GenerationStreamPort {
  const backend = process.env.GENERATION_STREAM_BACKEND ?? "memory"
  if (backend === "memory") {
    if (process.env.GENERATION_RUNTIME_MODE === "stateless")
      throw new Error("Stateless generation runtime requires Redis storage.")
    return new MemoryGenerationStreamPort()
  }
  if (backend === "redis") {
    const url = process.env.REDIS_URL
    if (!url)
      throw new Error("REDIS_URL is required for Redis generation streams.")
    return RedisGenerationStreamPort.fromUrl(url)
  }
  throw new Error(`Unknown generation stream backend: ${backend}`)
}

const globalForGeneration = globalThis as unknown as {
  nibchatGenerationStore?: GenerationStreamPort
  nibchatGenerationLifetime?: GenerationLifetimePort
  nibchatGenerationExecutor?: GenerationExecutorPort
}

export const generationStreamStore =
  globalForGeneration.nibchatGenerationStore ?? createStore()
globalForGeneration.nibchatGenerationStore = generationStreamStore

export const generationLifetime =
  globalForGeneration.nibchatGenerationLifetime ??
  createGenerationLifetimePort()
globalForGeneration.nibchatGenerationLifetime = generationLifetime

export const generationExecutor =
  globalForGeneration.nibchatGenerationExecutor ??
  new InProcessGenerationExecutor(generationLifetime)
globalForGeneration.nibchatGenerationExecutor = generationExecutor
