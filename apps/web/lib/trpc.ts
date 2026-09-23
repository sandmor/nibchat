import { reasoningSupportSchema } from "@/lib/reasoning"
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
  createMessage,
  createPromptStack,
  createContextBook,
  createProvider,
  createSpace,
  finishSetup,
  deleteChats,
  deleteNode,
  deletePromptStack,
  deleteContextBook,
  deleteProvider,
  deleteSpace,
  duplicatePromptStack,
  duplicateContextBook,
  forkMessageParts,
  moveNode,
  replaceMessage,
  getInstanceSettings,
  getWorkspace,
  listPromptStacks,
  listChatContextBooks,
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
  setChatVariables,
  setChatSpace,
  setChatsSpace,
  setInstanceTitleModel,
  updatePromptStack,
  updateContextBook,
  setChatContextBooks,
  updateProvider,
  updateSpace,
  updateChat,
  setChatViewState,
} from "@/lib/chat-service"
import {
  appendImportAsset,
  appendImportNodes,
  beginImport,
  inspectImports,
  finishImportAsset,
  getOrCreateImportSpace,
  listImportSpaceMappings,
  listImportBookMappings,
  resolveImportSpace,
  resolveImportBook,
  importAssetStatus,
  omitImportAsset,
  publishImport,
} from "@/lib/imports/adapters/database"
import {
  assetSchema,
  importEntitySchema,
  importNodeSchema,
  inspectConversationSchema,
  manifestSchema,
  sourceSchema,
} from "@/lib/imports/model"
import { listAvailableProviders, listProviders } from "@/lib/providers"
import { appearanceSchema } from "@/lib/appearance"
import { contextBookDocumentSchema } from "@/lib/context-books"
import {
  MAX_COLLECTION,
  MAX_DESCRIPTION,
  MAX_ID,
  MAX_IMPORT_NODES,
  MAX_NAME,
  MAX_UPLOAD_CHUNK_BYTES,
} from "@/lib/limits"
import { spaceSettingsSchema } from "@/lib/spaces"
import {
  promptStackDocumentSchema,
  promptVariableValueSchema,
} from "@/lib/prompt-stack"
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
import {
  attachmentReferenceSchema,
  messagePartSchema,
  type Parts,
} from "@/lib/agent/parts"
import {
  setUserThemeMode,
  setBuiltInToolsPrefs,
  setChatDefaults,
  setPdfImagePageLimit,
  setUserPromptStack,
} from "@/lib/user-settings"
import { modelConfigSchema, settingValuesSchema } from "@/lib/chat-settings"
import { chatViewStateSchema } from "@/lib/chat-view-state"
import { providerConnectionConfigSchema } from "@/lib/provider-config"
import { db } from "@/lib/db"
import {
  deleteChatTemplate,
  listChatTemplates,
  materializeChatTemplate,
  renameChatTemplate,
  saveChatTemplateFromChat,
  upsertSillyTavernCharacterTemplate,
} from "@/lib/chat-template-service"
import { chatTemplateDocumentSchema } from "@/lib/chat-template"
import { cadenceInputSchema, timeZoneSchema } from "@/lib/schedules/cadence"
import {
  createChatSchedule,
  createSchedule,
  createScheduledUserMessage,
  deleteSchedule,
  listSchedules,
  runScheduleNow,
  scheduleFromChat,
  sendAndScheduleTemplate,
  updateSchedule,
} from "@/lib/schedules/service"
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

const importScopeSchema = z.object({
  source: sourceSchema,
  parserVersion: z.number().int().positive(),
  conversationId: z.string().min(1).max(MAX_ID),
})
const providerModelSchema = z.object({
  reasoning: reasoningSupportSchema.optional(),
  id: z.string().trim().min(1).max(256),
  label: z.string().trim().max(120).optional(),
  enabled: z.boolean(),
  source: z.enum(["catalog", "custom"]),
  pdfInput: z.enum(["native", "extracted", "images"]),
  protocol: z.enum(["auto", "responses", "chat"]).optional(),
})
const providerInputSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["openai", "anthropic", "ollama", "openai-compatible"]),
  config: providerConnectionConfigSchema,
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
            title: z.string().trim().min(1).max(MAX_NAME).optional(),
            settings: settingValuesSchema.optional(),
            spaceId: z.string().nullable().optional(),
            contextBookIds: z.array(z.string()).max(MAX_COLLECTION).optional(),
          })
          .optional()
      )
      .mutation(({ ctx, input }) =>
        createChat(
          ctx.user.id,
          input?.title,
          input?.settings,
          input?.spaceId,
          input?.contextBookIds
        )
      ),
    getOrCreateImportSpace: userProcedure
      .input(
        z.object({
          source: sourceSchema,
          label: z.string().trim().min(1).max(MAX_NAME),
        })
      )
      .mutation(({ ctx, input }) =>
        getOrCreateImportSpace(ctx.user.id, input.source, input.label)
      ),
    importSpaceMappings: userProcedure
      .input(z.object({ source: sourceSchema }))
      .query(({ ctx, input }) =>
        listImportSpaceMappings(ctx.user.id, input.source)
      ),
    importBookMappings: userProcedure
      .input(z.object({ source: sourceSchema }))
      .query(({ ctx, input }) =>
        listImportBookMappings(ctx.user.id, input.source)
      ),
    resolveImportSpace: userProcedure
      .input(
        z.object({
          source: sourceSchema,
          entity: importEntitySchema,
          mode: z.enum(["managed", "existing", "root"]),
          rootSpaceId: z.string().min(1),
          destinationSpaceId: z.string().min(1).optional(),
          override: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const template =
          input.source === "sillytavern" && input.entity.kind === "character"
            ? await upsertSillyTavernCharacterTemplate({
                userId: ctx.user.id,
                entityId: input.entity.id,
                name: input.entity.label,
                beginnings: input.entity.chatTemplate?.beginnings ?? [],
                warnings: input.entity.chatTemplate?.warnings,
              })
            : null
        const variables = input.entity.variables
        const variableSettings =
          variables && Object.keys(variables).length
            ? {
                variables: Object.fromEntries(
                  Object.entries(variables).map(([name, value]) => [
                    name,
                    { mode: "require" as const, value },
                  ])
                ),
              }
            : {}
        const space = await resolveImportSpace({
          userId: ctx.user.id,
          source: input.source,
          entityId: input.entity.id,
          entityAliases: input.entity.aliases,
          mode: input.mode,
          rootSpaceId:
            input.mode === "existing"
              ? (input.destinationSpaceId ?? input.rootSpaceId)
              : input.rootSpaceId,
          label: input.entity.label,
          description: input.entity.description,
          settings:
            Object.keys(variableSettings).length || template
              ? {
                  ...variableSettings,
                  ...(template
                    ? {
                        chatTemplate: {
                          mode: "default" as const,
                          value: template.id,
                        },
                      }
                    : {}),
                }
              : undefined,
          metadata: input.entity.metadata,
          override: input.override,
        })
        return space
      }),
    resolveImportBook: userProcedure
      .input(
        z.object({
          source: sourceSchema,
          entityId: z.string().min(1).max(MAX_ID),
          name: z.string().min(1).max(MAX_NAME),
          book: contextBookDocumentSchema,
          spaceId: z.string().optional(),
          replace: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await resolveImportBook({ ...input, userId: ctx.user.id })
        } catch (error) {
          mapError(error)
        }
      }),
    inspectImports: userProcedure
      .input(
        z.object({
          source: sourceSchema,
          conversations: z
            .array(inspectConversationSchema)
            .min(1)
            .max(MAX_COLLECTION),
        })
      )
      .query(({ ctx, input }) =>
        inspectImports({
          userId: ctx.user.id,
          source: input.source,
          conversations: input.conversations,
        })
      ),
    beginImport: userProcedure
      .input(
        importScopeSchema.extend({
          manifest: manifestSchema.extend({
            spaceId: z.string().min(1),
          }),
        })
      )
      .mutation(({ ctx, input }) =>
        beginImport({ ...input, userId: ctx.user.id }, input.manifest)
      ),
    importAssetStatus: userProcedure
      .input(importScopeSchema.extend({ asset: assetSchema }))
      .query(({ ctx, input }) =>
        importAssetStatus({ ...input, userId: ctx.user.id }, input.asset)
      ),
    appendImportAsset: userProcedure
      .input(
        importScopeSchema.extend({
          asset: assetSchema,
          offset: z.number().int().nonnegative(),
          base64: z
            .string()
            .max(Math.ceil((MAX_UPLOAD_CHUNK_BYTES * 4) / 3) + 16),
        })
      )
      .mutation(({ ctx, input }) =>
        appendImportAsset(
          { ...input, userId: ctx.user.id },
          input.asset,
          input.offset,
          new Uint8Array(Buffer.from(input.base64, "base64"))
        )
      ),
    finishImportAsset: userProcedure
      .input(
        importScopeSchema.extend({
          asset: assetSchema,
          byteSize: z.number().int().positive(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
      )
      .mutation(({ ctx, input }) =>
        finishImportAsset(
          { ...input, userId: ctx.user.id },
          input.asset,
          input.byteSize,
          input.sha256
        )
      ),
    omitImportAsset: userProcedure
      .input(
        importScopeSchema.extend({
          asset: assetSchema,
          reason: z.string().min(1).max(MAX_DESCRIPTION),
        })
      )
      .mutation(({ ctx, input }) =>
        omitImportAsset(
          { ...input, userId: ctx.user.id },
          input.asset,
          input.reason
        )
      ),
    appendImportNodes: userProcedure
      .input(
        importScopeSchema.extend({
          offset: z.number().int().nonnegative(),
          nodes: z.array(importNodeSchema).min(1).max(MAX_COLLECTION),
        })
      )
      .mutation(({ ctx, input }) =>
        appendImportNodes(
          { ...input, userId: ctx.user.id },
          input.offset,
          input.nodes
        )
      ),
    publishImport: userProcedure
      .input(
        importScopeSchema.extend({
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        })
      )
      .mutation(({ ctx, input }) =>
        publishImport({ ...input, userId: ctx.user.id }, input.fingerprint)
      ),
    updateChat: userProcedure
      .input(
        z.object({
          chatId: z.string(),
          title: z.string().trim().min(1).max(MAX_NAME).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await updateChat(
            input.chatId,
            {
              title: input.title,
            },
            ctx.user.id
          )
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
    deleteChats: userProcedure
      .input(z.object({ chatIds: z.array(z.string()).min(1) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await deleteChats(ctx.user.id, input.chatIds)
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
    forkMessageParts: userProcedure
      .input(
        z.object({
          nodeId: z.string(),
          parts: z.array(messagePartSchema),
          attachments: z.array(attachmentReferenceSchema).max(20).optional(),
          role: z.enum(["user", "assistant"]).optional(),
          attachSelection: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await forkMessageParts({
            userId: ctx.user.id,
            nodeId: input.nodeId,
            parts: input.parts as Parts,
            attachments: input.attachments,
            role: input.role,
            attachSelection: input.attachSelection,
          })
        } catch (error) {
          mapError(error)
        }
      }),
    createMessage: userProcedure
      .input(
        z.object({
          chatId: z.string(),
          parentId: z.string().nullable(),
          beforeNodeId: z.string().optional(),
          role: z.enum(["user", "assistant"]),
          parts: z.array(messagePartSchema),
          attachments: z.array(attachmentReferenceSchema).max(20).optional(),
          attachSelection: z.boolean().optional(),
          schedule: z
            .object({
              at: z.string().datetime(),
              timeZone: timeZoneSchema,
              name: z.string().trim().min(1).max(MAX_NAME),
            })
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          if (input.schedule) {
            if (input.role !== "user")
              throw new Error(
                "A generation can only be scheduled from a user message."
              )
            return await createScheduledUserMessage({
              userId: ctx.user.id,
              chatId: input.chatId,
              parentId: input.parentId,
              beforeNodeId: input.beforeNodeId,
              parts: input.parts as Parts,
              attachments: input.attachments,
              attachSelection: input.attachSelection,
              name: input.schedule.name,
              at: input.schedule.at,
              timeZone: input.schedule.timeZone,
            })
          }
          return await createMessage({
            userId: ctx.user.id,
            chatId: input.chatId,
            parentId: input.parentId,
            beforeNodeId: input.beforeNodeId,
            role: input.role,
            parts: input.parts as Parts,
            attachments: input.attachments,
            attachSelection: input.attachSelection,
          })
        } catch (error) {
          mapError(error)
        }
      }),
    replaceMessage: userProcedure
      .input(
        z.object({
          nodeId: z.string(),
          parts: z.array(messagePartSchema),
          attachments: z.array(attachmentReferenceSchema).max(20).optional(),
          role: z.enum(["user", "assistant"]).optional(),
          expectedRevision: z.number().int().nonnegative().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await replaceMessage({
            userId: ctx.user.id,
            nodeId: input.nodeId,
            parts: input.parts as Parts,
            attachments: input.attachments,
            role: input.role,
            expectedRevision: input.expectedRevision,
          })
        } catch (error) {
          mapError(error)
        }
      }),
    moveNode: userProcedure
      .input(
        z.object({
          nodeId: z.string(),
          destinationParentId: z.string().nullable(),
          beforeNodeId: z.string().optional(),
          subtree: z.boolean(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          await moveNode({ ...input, userId: ctx.user.id })
          return { ok: true }
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
          name: z.string().min(1).max(MAX_NAME),
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
    listChatTemplates: userProcedure.query(({ ctx }) =>
      listChatTemplates(ctx.user.id)
    ),
    saveChatTemplateFromChat: userProcedure
      .input(
        z.object({
          chatId: z.string().min(1).max(MAX_ID),
          name: z.string().trim().min(1).max(MAX_NAME),
          templateId: z.string().min(1).max(MAX_ID).optional(),
          expectedRevision: z.number().int().min(0).optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        saveChatTemplateFromChat({ ...input, userId: ctx.user.id })
      ),
    deleteChatTemplate: userProcedure
      .input(z.object({ templateId: z.string().min(1).max(MAX_ID) }))
      .mutation(async ({ ctx, input }) => {
        await deleteChatTemplate(ctx.user.id, input.templateId)
        return { ok: true as const }
      }),
    listSchedules: userProcedure.query(({ ctx }) => listSchedules(ctx.user.id)),
    createSchedule: userProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(MAX_NAME),
          templateId: z.string().min(1).max(MAX_ID),
          spaceId: z.string().min(1).max(MAX_ID).nullable().optional(),
          cadence: cadenceInputSchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await createSchedule({ ...input, userId: ctx.user.id })
        } catch (error) {
          mapError(error)
        }
      }),
    createChatSchedule: userProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(MAX_NAME),
          chatId: z.string().min(1).max(MAX_ID),
          parentId: z.string().min(1).max(MAX_ID),
          at: z.string().datetime(),
          timeZone: timeZoneSchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await createChatSchedule({ ...input, userId: ctx.user.id })
        } catch (error) {
          mapError(error)
        }
      }),
    updateSchedule: userProcedure
      .input(
        z.object({
          id: z.string().min(1).max(MAX_ID),
          name: z.string().trim().min(1).max(MAX_NAME).optional(),
          spaceId: z.string().min(1).max(MAX_ID).nullable().optional(),
          cadence: cadenceInputSchema.optional(),
          enabled: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { id, ...patch } = input
          return await updateSchedule({ ...patch, id, userId: ctx.user.id })
        } catch (error) {
          mapError(error)
        }
      }),
    deleteSchedule: userProcedure
      .input(z.object({ id: z.string().min(1).max(MAX_ID) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await deleteSchedule(ctx.user.id, input.id)
        } catch (error) {
          mapError(error)
        }
      }),
    scheduleFromChat: userProcedure
      .input(
        z.object({
          chatId: z.string().min(1).max(MAX_ID),
          name: z.string().trim().min(1).max(MAX_NAME),
          templateId: z.string().min(1).max(MAX_ID).optional(),
          expectedRevision: z.number().int().min(0).optional(),
          spaceId: z.string().min(1).max(MAX_ID).nullable().optional(),
          cadence: cadenceInputSchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await scheduleFromChat({ ...input, userId: ctx.user.id })
        } catch (error) {
          mapError(error)
        }
      }),
    sendAndScheduleTemplate: userProcedure
      .input(
        z.object({
          source: z.discriminatedUnion("kind", [
            z.object({
              kind: z.literal("chat"),
              chatId: z.string().min(1).max(MAX_ID),
              parentId: z.string().min(1).max(MAX_ID).nullable(),
            }),
            z.object({
              kind: z.literal("draft"),
              document: chatTemplateDocumentSchema,
              parentId: z.string().min(1).max(MAX_ID).nullable(),
              chatOverrides: settingValuesSchema,
            }),
          ]),
          parts: z.array(messagePartSchema),
          attachments: z
            .array(attachmentReferenceSchema)
            .max(MAX_COLLECTION)
            .optional(),
          name: z.string().trim().min(1).max(MAX_NAME),
          spaceId: z.string().min(1).max(MAX_ID).nullable().optional(),
          cadence: cadenceInputSchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await sendAndScheduleTemplate({
            ...input,
            userId: ctx.user.id,
          })
        } catch (error) {
          mapError(error)
        }
      }),
    runScheduleNow: userProcedure
      .input(z.object({ id: z.string().min(1).max(MAX_ID) }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await runScheduleNow(ctx.user.id, input.id)
        } catch (error) {
          mapError(error)
        }
      }),
    renameChatTemplate: userProcedure
      .input(
        z.object({
          templateId: z.string().min(1).max(MAX_ID),
          name: z.string().trim().min(1).max(MAX_NAME),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await renameChatTemplate(ctx.user.id, input.templateId, input.name)
        return { ok: true as const }
      }),
    materializeChatTemplate: userProcedure
      .input(
        z.object({
          templateId: z.string().min(1).max(MAX_ID).optional(),
          document: chatTemplateDocumentSchema,
          draftId: z.string().min(1).max(MAX_ID),
          selectedRootId: z.string().min(1).max(MAX_ID).nullable().optional(),
          selectedChildren: z
            .record(
              z.string().min(1).max(MAX_ID),
              z.string().min(1).max(MAX_ID).nullable()
            )
            .refine(
              (entries) => Object.keys(entries).length <= MAX_IMPORT_NODES
            )
            .optional(),
          title: z.string().trim().min(1).max(MAX_NAME).nullable().optional(),
          settings: settingValuesSchema.optional(),
          spaceId: z.string().nullable().optional(),
          contextBookIds: z.array(z.string()).max(MAX_COLLECTION).optional(),
          expandMessageMacros: z.boolean().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        materializeChatTemplate({ ...input, userId: ctx.user.id })
      ),
    setChatDefaults: userProcedure
      .input(modelConfigSchema)
      .mutation(async ({ ctx, input }) => {
        await setChatDefaults(ctx.user.id, input)
        return { ok: true }
      }),
    listThemes: userProcedure.query(({ ctx }) => listThemes(ctx.user.id)),
    createTheme: userProcedure
      .input(
        z.object({
          name: z.string().min(1).max(MAX_NAME),
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
          name: z.string().min(1).max(MAX_NAME).optional(),
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
          name: z.string().min(1).max(MAX_NAME).optional(),
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
    setPdfImagePageLimit: userProcedure
      .input(z.object({ pageLimit: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        return await setPdfImagePageLimit(ctx.user.id, input.pageLimit)
      }),
    listPromptStacks: userProcedure.query(({ ctx }) =>
      listPromptStacks(ctx.user.id)
    ),
    listChatContextBooks: userProcedure
      .input(z.object({ chatId: z.string() }))
      .query(({ ctx, input }) =>
        listChatContextBooks(ctx.user.id, input.chatId)
      ),
    createContextBook: userProcedure
      .input(
        z.object({
          name: z.string().min(1).max(MAX_NAME),
          book: contextBookDocumentSchema.optional(),
          spaceId: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await createContextBook({ ...input, userId: ctx.user.id })
        } catch (error) {
          mapError(error)
        }
      }),
    updateContextBook: userProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(MAX_NAME).optional(),
          book: contextBookDocumentSchema.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const { id, ...patch } = input
          return await updateContextBook(ctx.user.id, id, patch)
        } catch (error) {
          mapError(error)
        }
      }),
    duplicateContextBook: userProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await duplicateContextBook(ctx.user.id, input.id)
        } catch (error) {
          mapError(error)
        }
      }),
    deleteContextBook: userProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await deleteContextBook(ctx.user.id, input.id)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    setChatContextBooks: userProcedure
      .input(
        z.object({
          chatId: z.string(),
          bookIds: z.array(z.string()).max(MAX_COLLECTION),
        })
      )
      .mutation(async ({ ctx, input }) =>
        setChatContextBooks(ctx.user.id, input.chatId, input.bookIds)
      ),
    createPromptStack: userProcedure
      .input(
        z.object({
          name: z.string().min(1).max(MAX_NAME),
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
          name: z.string().min(1).max(MAX_NAME).optional(),
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
          name: z.string().min(1).max(MAX_NAME).optional(),
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
    setUserPromptStack: userProcedure
      .input(z.object({ stackId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await setUserPromptStack(ctx.user.id, input.stackId)
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
    setChatVariables: userProcedure
      .input(
        z.object({
          chatId: z.string(),
          values: z.record(z.string(), promptVariableValueSchema),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await setChatVariables({ userId: ctx.user.id, ...input })
        } catch (error) {
          mapError(error)
        }
      }),
    createSpace: userProcedure
      .input(
        z.object({
          parentId: z.string().nullable().optional(),
          name: z.string().trim().min(1).max(MAX_NAME).optional(),
          description: z.string().max(MAX_DESCRIPTION).optional(),
          settings: spaceSettingsSchema.optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await createSpace({ userId: ctx.user.id, ...input })
        } catch (error) {
          mapError(error)
        }
      }),
    updateSpace: userProcedure
      .input(
        z.object({
          spaceId: z.string(),
          parentId: z.string().nullable().optional(),
          name: z.string().trim().min(1).max(MAX_NAME).optional(),
          description: z.string().max(MAX_DESCRIPTION).optional(),
          settings: spaceSettingsSchema.optional(),
          expectedUpdatedAt: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await updateSpace({ userId: ctx.user.id, ...input })
        } catch (error) {
          mapError(error)
        }
      }),
    deleteSpace: userProcedure
      .input(z.object({ spaceId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await deleteSpace(ctx.user.id, input.spaceId)
        } catch (error) {
          mapError(error)
        }
      }),
    setChatSpace: userProcedure
      .input(
        z.object({
          chatId: z.string(),
          spaceId: z.string().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await setChatSpace(ctx.user.id, input.chatId, input.spaceId)
        } catch (error) {
          mapError(error)
        }
      }),
    setChatsSpace: userProcedure
      .input(
        z.object({
          chatIds: z.array(z.string()).min(1),
          spaceId: z.string().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          return await setChatsSpace(ctx.user.id, input.chatIds, input.spaceId)
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
