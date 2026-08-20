import { db } from "@/lib/db"
import type { InstanceOwnerPort } from "@/lib/identity/ports"

export async function getOwnerUserId() {
  const row = await db
    .selectFrom("instance")
    .select("owner_user_id")
    .where("id", "=", 1)
    .executeTakeFirst()
  return row?.owner_user_id ?? null
}

export async function isOnboardingComplete() {
  const row = await db
    .selectFrom("instance")
    .select("onboarding_completed_at")
    .where("id", "=", 1)
    .executeTakeFirst()
  return row?.onboarding_completed_at != null
}

export async function completeOnboarding() {
  const timestamp = new Date().toISOString()
  await db
    .updateTable("instance")
    .set({ onboarding_completed_at: timestamp })
    .where("id", "=", 1)
    .where("onboarding_completed_at", "is", null)
    .execute()
}

export function createKyselyInstanceOwnerPort(): InstanceOwnerPort {
  return {
    getOwnerUserId,
    async tryClaimOwner(userId: string) {
      const result = await db
        .updateTable("instance")
        .set({ owner_user_id: userId })
        .where("id", "=", 1)
        .where("owner_user_id", "is", null)
        .executeTakeFirst()
      return Number(result.numUpdatedRows ?? 0) > 0
    },
    isOnboardingComplete,
    completeOnboarding,
  }
}
