import "server-only"
import { initTRPC, TRPCError } from "@trpc/server"
import { z, ZodError } from "zod"
import {
  OWNER_FORBIDDEN_MESSAGE,
  UNAUTHORIZED_MESSAGE,
  resolveAppUser,
  type SessionUser,
} from "@/lib/app-session"

import {
  createChat,
  createPromptStack,
  createProvider,
  finishSetup,
  deleteChat,
  deleteNode,
  deletePromptStack,
  deleteProvider,
  duplicatePromptStack,
  forkEdit,
  getInstanceSettings,
  getWorkspace,
  listPromptStacks,
  searchChats,
  selectChild,
  setNodeContextExcluded,
  selectPath,
  selectRoot,
  createTheme,
  deleteTheme,
  duplicateTheme,
  listThemes,
  setThemeSlots,
  updateTheme,
  setChatPromptStack,
  setInstanceDefaultPromptStack,
  setInstanceTitleModel,
  updateChat,
  updatePromptStack,
  updateProvider,
  setChatViewState,
} from "@/lib/chat-service"
import { listAvailableProviders, listProviders } from "@/lib/providers"
import { appearanceSchema } from "@/lib/appearance"
import { promptStackDocumentSchema } from "@/lib/prompt-stack"
import {
  approveMcpCatalog,
  createMcpProfile,
  deleteMcpProfile,
  getMcpPrompt,
  listApprovedMcpSurfaces,
  listMcpProfiles,
  mcpProfileInputSchema,
  refreshMcpCatalog,
  updateMcpProfile,
} from "@/lib/mcp"
import { messageEditSegmentSchema } from "@/lib/agent/parts"
import { setUserThemeMode, setBuiltInToolsPrefs } from "@/lib/user-settings"
import { chatViewStateSchema } from "@/lib/chat-view-state"
import { db } from "@/lib/db"
import {
  createManagedUser,
  deleteManagedUser,
  listManagedUsers,
  resetManagedUserPassword,
  revokeManagedUserSessions,
  setManagedUserDisabled,
} from "@/lib/user-admin"

export async function createContext({ req }: { req: Request }) {
  const gate = await resolveAppUser(req.headers)
  if (gate.status === "ok" || gate.status === "onboarding") {
    return {
      user: gate.user as SessionUser,
      isOwner: gate.user.id === (await defaultIdentityOwnerId()),
      headers: req.headers,
      authError: null as string | null,
    }
  }
  return {
    user: null as SessionUser | null,
    isOwner: false,
    headers: req.headers,
    authError: UNAUTHORIZED_MESSAGE,
  }
}

async function defaultIdentityOwnerId() {
  const row = await db
    .selectFrom("instance")
    .select("owner_user_id")
    .where("id", "=", 1)
    .executeTakeFirst()
  return row?.owner_user_id ?? null
}

const t = initTRPC.context<typeof createContext>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause
    if (cause instanceof ZodError) {
      return {
        ...shape,
        message: formatZodIssues(cause),
      }
    }
    return shape
  },
})
const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  if (!ctx.isOwner)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: OWNER_FORBIDDEN_MESSAGE,
    })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

const userProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" })
  return next({ ctx: { ...ctx, user: ctx.user } })
})

const modelConfigSchema = z.object({
  providerId: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  topP: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  presencePenalty: z.number().optional(),
  stopSequences: z.array(z.string()).optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  replayReasoning: z.boolean().optional(),
})
const providerModelSchema = z.object({
  id: z.string().trim().min(1).max(256),
  label: z.string().trim().max(120).optional(),
  enabled: z.boolean(),
  source: z.enum(["catalog", "custom"]),
  pdfInput: z.enum(["native", "extracted"]),
  protocol: z.enum(["auto", "responses", "chat"]).optional(),
})
const providerInputSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["openai", "anthropic", "ollama", "openai-compatible"]),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  models: z.array(providerModelSchema),
})

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  namespace: "Tool namespace",
  transport: "Transport",
  protocolMode: "Protocol",
  "config.url": "Server URL",
  "config.command": "Command",
  "config.cwd": "Working directory",
}

function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".")
      const label = FIELD_LABELS[path] ?? (path || "Input")
      const raw = issue.message
      if (
        path === "namespace" &&
        (raw.startsWith("Too small") || raw.startsWith("Invalid string"))
      ) {
        return "Tool namespace must start with a letter and use only letters, numbers, and underscores"
      }
      if (path === "name" && raw.startsWith("Too small"))
        return "Name is required"
      if (path === "config.url")
        return "Server URL is required and must be a valid URL"
      if (path === "config.command" && raw.startsWith("Too small"))
        return "Command is required"
      if (
        raw.startsWith("Too small") ||
        raw.startsWith("Invalid string") ||
        raw.startsWith("Invalid input")
      ) {
        return `${label} is invalid`
      }
      return raw.includes(label) ? raw : `${label}: ${raw}`
    })
    .join(" · ")
}

function humanizeError(error: unknown): string {
  if (error instanceof ZodError) return formatZodIssues(error)
  if (error instanceof Error) {
    // ZodError message is often a JSON dump in Zod 4
    if (error.name === "ZodError" && "issues" in error)
      return formatZodIssues(error as ZodError)
    const trimmed = error.message.trim()
    if (trimmed.startsWith("[") && trimmed.includes('"code"')) {
      try {
        const parsed = JSON.parse(trimmed) as Array<{
          path?: (string | number)[]
          message?: string
          code?: string
        }>
        if (Array.isArray(parsed) && parsed[0]?.message) {
          return formatZodIssues({
            issues: parsed.map((item) => ({
              path: item.path ?? [],
              message: item.message ?? "Invalid",
              code: item.code ?? "custom",
            })),
          } as ZodError)
        }
      } catch {
        /* keep original */
      }
    }
    return error.message
  }
  return "Request failed"
}

function mapError(error: unknown): never {
  const message = humanizeError(error)
  if (message.toLowerCase().includes("not found"))
    throw new TRPCError({ code: "NOT_FOUND", message })
  throw new TRPCError({ code: "BAD_REQUEST", message })
}

export const appRouter = t.router({
  workspace: t.router({
    get: userProcedure
      .input(
        z
          .object({
            chatId: z.string().optional(),
            draft: z.boolean().optional(),
          })
          .optional()
      )
      .query(({ ctx, input }) => getWorkspace(ctx.user.id, input)),
    search: userProcedure
      .input(z.object({ query: z.string().min(1).max(300) }))
      .query(({ ctx, input }) => searchChats(ctx.user.id, input.query)),
    createChat: userProcedure
      .input(
        z
          .object({
            title: z.string().trim().min(1).max(200).optional(),
            config: modelConfigSchema.optional(),
            promptStackId: z.string().nullable().optional(),
          })
          .optional()
      )
      .mutation(({ ctx, input }) =>
        createChat(
          ctx.user.id,
          input?.title,
          input?.config,
          input?.promptStackId
        )
      ),
    updateChat: userProcedure
      .input(
        z.object({
          chatId: z.string(),
          title: z.string().trim().min(1).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await updateChat(input.chatId, { title: input.title }, ctx.user.id)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    setChatViewState: userProcedure
      .input(z.object({ chatId: z.string(), state: chatViewStateSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          await setChatViewState(ctx.user.id, input.chatId, input.state)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    deleteChat: userProcedure
      .input(z.object({ chatId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await deleteChat(ctx.user.id, input.chatId)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    setModel: userProcedure
      .input(z.object({ chatId: z.string(), config: modelConfigSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          await updateChat(input.chatId, { model: input.config }, ctx.user.id)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    selectChild: userProcedure
      .input(z.object({ nodeId: z.string(), childId: z.string().nullable() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await selectChild(ctx.user.id, input.nodeId, input.childId)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    selectRoot: userProcedure
      .input(z.object({ chatId: z.string(), nodeId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await selectRoot(ctx.user.id, input.chatId, input.nodeId)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    selectPath: userProcedure
      .input(z.object({ chatId: z.string(), nodeId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await selectPath(ctx.user.id, input.chatId, input.nodeId)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    setContextExcluded: userProcedure
      .input(z.object({ nodeId: z.string(), excluded: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await setNodeContextExcluded(
            ctx.user.id,
            input.nodeId,
            input.excluded
          )
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    forkEdit: userProcedure
      .input(
        z.object({
          nodeId: z.string(),
          edits: z.array(messageEditSegmentSchema).min(1),
          attachSelection: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const node = await forkEdit(ctx.user.id, input.nodeId, input.edits, {
            attachSelection: input.attachSelection,
          })
          return { ok: true, node }
        } catch (error) {
          mapError(error)
        }
      }),
    deleteNode: userProcedure
      .input(
        z.object({
          nodeId: z.string(),
          mode: z.enum(["subtree", "reparent"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await deleteNode(ctx.user.id, input.nodeId, input.mode)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    listProviders: userProcedure.query(({ ctx }) =>
      ctx.isOwner ? listProviders() : listAvailableProviders()
    ),
    listMcpProfiles: ownerProcedure.query(({ ctx }) =>
      listMcpProfiles(ctx.user.id)
    ),
    createMcpProfile: ownerProcedure
      .input(mcpProfileInputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          return await createMcpProfile(ctx.user.id, input)
        } catch (error) {
          mapError(error)
        }
      }),
    updateMcpProfile: ownerProcedure
      .input(
        z.intersection(mcpProfileInputSchema, z.object({ id: z.string() }))
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { id, ...profile } = input
          await updateMcpProfile(ctx.user.id, id, profile)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    deleteMcpProfile: ownerProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await deleteMcpProfile(ctx.user.id, input.id)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    refreshMcpCatalog: ownerProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await refreshMcpCatalog(ctx.user.id, input.id)
        } catch (error) {
          mapError(error)
        }
      }),
    approveMcpCatalog: ownerProcedure
      .input(
        z.object({
          id: z.string(),
          toolAllowlist: z.array(z.string()).max(500),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await approveMcpCatalog(ctx.user.id, input.id, input.toolAllowlist)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    listApprovedMcpSurfaces: userProcedure.query(() =>
      listApprovedMcpSurfaces()
    ),
    getMcpPrompt: userProcedure
      .input(
        z.object({
          profileId: z.string().min(1),
          name: z.string().min(1).max(200),
          arguments: z.record(z.string(), z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await getMcpPrompt(
            input.profileId,
            input.name,
            input.arguments ?? {}
          )
        } catch (error) {
          mapError(error)
        }
      }),
    createProvider: ownerProcedure
      .input(providerInputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          return await createProvider(ctx.user.id, input)
        } catch (error) {
          mapError(error)
        }
      }),
    finishSetup: ownerProcedure
      .input(
        z
          .object({
            provider: providerInputSchema
              .extend({ id: z.string().optional() })
              .optional(),
            titleModel: z.string().trim().min(1).max(256).optional(),
          })
          .nullable()
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await finishSetup(ctx.user.id, input)
        } catch (error) {
          mapError(error)
        }
      }),
    updateProvider: ownerProcedure
      .input(providerInputSchema.extend({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          const { id, ...profile } = input
          await updateProvider(ctx.user.id, id, profile)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    deleteProvider: ownerProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await deleteProvider(ctx.user.id, input.id)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    getSettings: userProcedure.query(async ({ ctx }) => {
      const settings = await getInstanceSettings(ctx.user.id)
      return ctx.isOwner ? settings : { ...settings, titleModelConfig: null }
    }),
    listThemes: userProcedure.query(({ ctx }) => listThemes(ctx.user.id)),
    createTheme: userProcedure
      .input(
        z.object({
          name: z.string().min(1).max(200),
          document: appearanceSchema.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await createTheme({ ...input, userId: ctx.user.id })
        } catch (error) {
          mapError(error)
        }
      }),
    updateTheme: userProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(200).optional(),
          document: appearanceSchema.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { id, ...patch } = input
          return await updateTheme(ctx.user.id, id, patch)
        } catch (error) {
          mapError(error)
        }
      }),
    duplicateTheme: userProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await duplicateTheme(ctx.user.id, input.id, input.name)
        } catch (error) {
          mapError(error)
        }
      }),
    deleteTheme: userProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await deleteTheme(ctx.user.id, input.id)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    setThemeSlots: userProcedure
      .input(
        z.object({
          lightThemeId: z.string(),
          darkThemeId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await setThemeSlots({ ...input, userId: ctx.user.id })
        } catch (error) {
          mapError(error)
        }
      }),
    setThemeMode: userProcedure
      .input(z.object({ themeMode: z.enum(["system", "light", "dark"]) }))
      .mutation(async ({ ctx, input }) => {
        await setUserThemeMode(ctx.user.id, input.themeMode)
        return { ok: true as const }
      }),
    setBuiltInTools: userProcedure
      .input(z.object({ disabled: z.array(z.string().min(1).max(64)).max(32) }))
      .mutation(async ({ ctx, input }) => {
        return await setBuiltInToolsPrefs(ctx.user.id, input.disabled)
      }),
    listPromptStacks: userProcedure.query(({ ctx }) =>
      listPromptStacks(ctx.user.id)
    ),
    createPromptStack: userProcedure
      .input(
        z.object({
          name: z.string().min(1).max(200),
          stack: promptStackDocumentSchema.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await createPromptStack({ ...input, userId: ctx.user.id })
        } catch (error) {
          mapError(error)
        }
      }),
    updatePromptStack: userProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(200).optional(),
          stack: promptStackDocumentSchema.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { id, ...patch } = input
          return await updatePromptStack(ctx.user.id, id, patch)
        } catch (error) {
          mapError(error)
        }
      }),
    duplicatePromptStack: userProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(200).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await duplicatePromptStack(ctx.user.id, input.id, input.name)
        } catch (error) {
          mapError(error)
        }
      }),
    deletePromptStack: userProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await deletePromptStack(ctx.user.id, input.id)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    setInstanceDefaultPromptStack: userProcedure
      .input(z.object({ stackId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await setInstanceDefaultPromptStack(ctx.user.id, input.stackId)
        } catch (error) {
          mapError(error)
        }
      }),
    setInstanceTitleModel: ownerProcedure
      .input(
        z
          .object({
            providerId: z.string().min(1),
            model: z.string().min(1),
          })
          .nullable()
      )
      .mutation(async ({ input }) => {
        try {
          return await setInstanceTitleModel(input)
        } catch (error) {
          mapError(error)
        }
      }),
    setChatPromptStack: userProcedure
      .input(
        z.object({
          chatId: z.string(),
          stackId: z.string().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await setChatPromptStack(
            ctx.user.id,
            input.chatId,
            input.stackId
          )
        } catch (error) {
          mapError(error)
        }
      }),
  }),
  admin: t.router({
    listUsers: ownerProcedure.query(({ ctx }) => listManagedUsers(ctx.headers)),
    createUser: ownerProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(120),
          email: z.string().email(),
          password: z.string().min(8).max(256),
        })
      )
      .mutation(({ ctx, input }) => createManagedUser(ctx.headers, input)),
    resetUserPassword: ownerProcedure
      .input(
        z.object({ userId: z.string(), password: z.string().min(8).max(256) })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The owner account cannot be changed here.",
          })
        await resetManagedUserPassword(
          ctx.headers,
          input.userId,
          input.password
        )
        return { ok: true as const }
      }),
    setUserDisabled: ownerProcedure
      .input(z.object({ userId: z.string(), disabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The owner account cannot be disabled.",
          })
        await setManagedUserDisabled(ctx.headers, input.userId, input.disabled)
        return { ok: true as const }
      }),
    revokeUserSessions: ownerProcedure
      .input(z.object({ userId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The owner sessions cannot be revoked here.",
          })
        await revokeManagedUserSessions(ctx.headers, input.userId)
        return { ok: true as const }
      }),
    deleteUser: ownerProcedure
      .input(z.object({ userId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The owner account cannot be deleted.",
          })
        await deleteManagedUser(ctx.headers, input.userId)
        return { ok: true as const }
      }),
  }),
})

export type AppRouter = typeof appRouter
