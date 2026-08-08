import { db } from "@/lib/db"
import type { InstanceOwnerPort } from "@/lib/identity/ports"

export function createKyselyInstanceOwnerPort(): InstanceOwnerPort {
  return {
    async getOwnerUserId() {
      const row = await db
        .selectFrom("instance")
        .select("owner_user_id")
        .where("id", "=", 1)
        .executeTakeFirst()
      return row?.owner_user_id ?? null
    },
    async tryClaimOwner(userId: string) {
      const result = await db
        .updateTable("instance")
        .set({ owner_user_id: userId })
        .where("id", "=", 1)
        .where("owner_user_id", "is", null)
        .executeTakeFirst()
      return Number(result.numUpdatedRows ?? 0) > 0
    },
  }
}
