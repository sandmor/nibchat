import type { SessionPort, SessionUser } from "@/lib/identity/ports"
import { auth } from "@/lib/better-auth"

/**
 * Better Auth session adapter. Does not migrate — callers must ensure schema
 * readiness (application resolve migrates once per request).
 */
export function createBetterAuthSessionPort(): SessionPort {
  return {
    async getSession(headers) {
      const session = await auth.api.getSession({ headers })
      if (!session?.user) return null
      return { user: session.user as SessionUser }
    },
  }
}
