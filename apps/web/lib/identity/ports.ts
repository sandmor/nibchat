/** Minimal session user used by the app gate (identity only). */
export type SessionUser = {
  id: string
  email: string
  name: string
  emailVerified: boolean
  image?: string | null
  createdAt: Date
  updatedAt: Date
  role?: string | null
  banned?: boolean | null
}

export interface SessionPort {
  getSession(headers: globalThis.Headers): Promise<{ user: SessionUser } | null>
}

export interface InstanceOwnerPort {
  getOwnerUserId(): Promise<string | null>
  /** CAS: set owner only when currently null. Returns whether this caller won. */
  tryClaimOwner(userId: string): Promise<boolean>
  isOnboardingComplete(): Promise<boolean>
  completeOnboarding(): Promise<void>
}

export interface SchemaPort {
  migrate(): Promise<void>
}

export type IdentityPorts = {
  session: SessionPort
  instance: InstanceOwnerPort
  schema: SchemaPort
}
