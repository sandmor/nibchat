import { migrate } from "@/lib/db"
import type { SchemaPort } from "@/lib/identity/ports"

export function createSchemaPort(): SchemaPort {
  return {
    migrate: () => migrate(),
  }
}
