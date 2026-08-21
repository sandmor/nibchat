import "server-only"
import { auth } from "@/lib/better-auth"
import { db } from "@/lib/db"
import { removeFileIfUnreferenced } from "@/lib/attachments"
import { ensureUserSettings } from "@/lib/user-settings"

export type ManagedUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string | null
  role?: string | null
  banned?: boolean | null
  banReason?: string | null
  createdAt: Date
  updatedAt: Date
}

export async function listManagedUsers(requestHeaders: Headers) {
  const result = await auth.api.listUsers({
    query: { limit: 200, offset: 0, sortBy: "createdAt", sortDirection: "asc" },
    headers: requestHeaders,
  })
  return result.users as ManagedUser[]
}

export async function createManagedUser(
  requestHeaders: Headers,
  input: { name: string; email: string; password: string }
) {
  const result = await auth.api.createUser({
    body: { name: input.name, email: input.email, password: input.password, role: "user" },
    headers: requestHeaders,
  })
  try {
    await ensureUserSettings(result.user.id)
  } catch (error) {
    await auth.api.removeUser({
      body: { userId: result.user.id },
      headers: requestHeaders,
    })
    throw error
  }
  return result.user as ManagedUser
}

export async function resetManagedUserPassword(
  requestHeaders: Headers,
  userId: string,
  newPassword: string
) {
  await auth.api.setUserPassword({
    body: { userId, newPassword },
    headers: requestHeaders,
  })
  await auth.api.revokeUserSessions({
    body: { userId },
    headers: requestHeaders,
  })
}

export async function setManagedUserDisabled(
  requestHeaders: Headers,
  userId: string,
  disabled: boolean
) {
  if (disabled) {
    await auth.api.banUser({
      body: { userId, banReason: "Disabled by the instance owner." },
      headers: requestHeaders,
    })
  } else {
    await auth.api.unbanUser({
      body: { userId },
      headers: requestHeaders,
    })
  }
}

export async function revokeManagedUserSessions(
  requestHeaders: Headers,
  userId: string
) {
  await auth.api.revokeUserSessions({
    body: { userId },
    headers: requestHeaders,
  })
}

export async function deleteManagedUser(
  requestHeaders: Headers,
  userId: string
) {
  const attachments = await db
    .selectFrom("attachments")
    .select(["storage_key", "data"])
    .where("user_id", "=", userId)
    .execute()
  await auth.api.removeUser({
    body: { userId },
    headers: requestHeaders,
  })
  // Filesystem storage is content-addressed and may be shared by attachment
  // rows owned by other users. Remove bytes only after the account cascade,
  // and only when no row still refers to the key.
  for (const attachment of attachments) {
    if (attachment.storage_key)
      await removeFileIfUnreferenced(attachment.storage_key)
  }
}
