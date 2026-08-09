import "server-only"
import { initTRPC, TRPCError } from "@trpc/server"
import { z } from "zod"
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
  deleteChat,
  deleteNode,
  deletePromptStack,
  deleteProvider,
  duplicatePromptStack,
  forkEdit,
  getInstanceSettings,
  getWorkspace,
  listPromptStacks,
  previewAssembledContext,
  searchChats,
  selectChild,
  selectPath,
  selectRoot,
  setAppearance,
  setChatPromptStack,
  setInstanceDefaultPromptStack,
  updateChat,
  updatePromptStack,
  updateProvider,
} from "@/lib/chat-service"
import { listProviders } from "@/lib/providers"
import { appearanceSchema } from "@/lib/appearance"
import { promptStackDocumentSchema } from "@/lib/prompt-stack"

export async function createContext({ req }: { req: Request }) {
  const gate = await resolveAppUser(req.headers)
  if (gate.status === "ok") {
    return {
      user: gate.user as SessionUser,
      authError: null as string | null,
    }
  }
  return {
    user: null as SessionUser | null,
    authError:
      gate.status === "wrong_account"
        ? OWNER_FORBIDDEN_MESSAGE
        : UNAUTHORIZED_MESSAGE,
  }
}

const t = initTRPC.context<typeof createContext>().create()
const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    if (ctx.authError === OWNER_FORBIDDEN_MESSAGE)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ctx.authError,
      })
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  return next({ ctx: { user: ctx.user } })
})

import { partsSchema } from "@/lib/agent/parts"
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
const providerInputSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["openai", "anthropic", "openai-compatible"]),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  models: z.array(z.string()),
})

function mapError(error: unknown): never {
  const message = error instanceof Error ? error.message : "Request failed"
  if (message.toLowerCase().includes("not found"))
    throw new TRPCError({ code: "NOT_FOUND", message })
  throw new TRPCError({ code: "BAD_REQUEST", message })
}

export const appRouter = t.router({
  workspace: t.router({
    get: ownerProcedure
      .input(
        z
          .object({
            chatId: z.string().optional(),
            draft: z.boolean().optional(),
          })
          .optional()
      )
      .query(({ ctx, input }) => getWorkspace(ctx.user.id, input)),
    search: ownerProcedure
      .input(z.object({ query: z.string().min(1).max(300) }))
      .query(({ ctx, input }) => searchChats(ctx.user.id, input.query)),
    createChat: ownerProcedure
      .input(
        z
          .object({
            title: z.string().max(200).optional(),
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
    updateChat: ownerProcedure
      .input(
        z.object({
          chatId: z.string(),
          title: z.string().max(200).optional(),
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
    deleteChat: ownerProcedure
      .input(z.object({ chatId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await deleteChat(ctx.user.id, input.chatId)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    setModel: ownerProcedure
      .input(z.object({ chatId: z.string(), config: modelConfigSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          await updateChat(input.chatId, { model: input.config }, ctx.user.id)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    selectChild: ownerProcedure
      .input(z.object({ nodeId: z.string(), childId: z.string().nullable() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await selectChild(ctx.user.id, input.nodeId, input.childId)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    selectRoot: ownerProcedure
      .input(z.object({ chatId: z.string(), nodeId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await selectRoot(ctx.user.id, input.chatId, input.nodeId)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    selectPath: ownerProcedure
      .input(z.object({ chatId: z.string(), nodeId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await selectPath(ctx.user.id, input.chatId, input.nodeId)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    forkEdit: ownerProcedure
      .input(z.object({ nodeId: z.string(), parts: partsSchema }))
      .mutation(async ({ ctx, input }) => {
        try {
          const node = await forkEdit(ctx.user.id, input.nodeId, input.parts)
          return { ok: true, node }
        } catch (error) {
          mapError(error)
        }
      }),
    deleteNode: ownerProcedure
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
    listProviders: ownerProcedure.query(({ ctx }) =>
      listProviders(ctx.user.id)
    ),
    createProvider: ownerProcedure
      .input(providerInputSchema)
      .mutation(async ({ ctx, input }) => {
        try {
          return await createProvider(ctx.user.id, input)
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
    getSettings: ownerProcedure.query(() => getInstanceSettings()),
    setAppearance: ownerProcedure
      .input(appearanceSchema)
      .mutation(async ({ input }) => {
        try {
          return await setAppearance(input)
        } catch (error) {
          mapError(error)
        }
      }),
    listPromptStacks: ownerProcedure.query(() => listPromptStacks()),
    createPromptStack: ownerProcedure
      .input(
        z.object({
          name: z.string().min(1).max(200),
          stack: promptStackDocumentSchema.optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          return await createPromptStack(input)
        } catch (error) {
          mapError(error)
        }
      }),
    updatePromptStack: ownerProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(200).optional(),
          stack: promptStackDocumentSchema.optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          const { id, ...patch } = input
          return await updatePromptStack(id, patch)
        } catch (error) {
          mapError(error)
        }
      }),
    duplicatePromptStack: ownerProcedure
      .input(
        z.object({
          id: z.string(),
          name: z.string().min(1).max(200).optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          return await duplicatePromptStack(input.id, input.name)
        } catch (error) {
          mapError(error)
        }
      }),
    deletePromptStack: ownerProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        try {
          await deletePromptStack(input.id)
          return { ok: true }
        } catch (error) {
          mapError(error)
        }
      }),
    setInstanceDefaultPromptStack: ownerProcedure
      .input(z.object({ stackId: z.string() }))
      .mutation(async ({ input }) => {
        try {
          return await setInstanceDefaultPromptStack(input.stackId)
        } catch (error) {
          mapError(error)
        }
      }),
    setChatPromptStack: ownerProcedure
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
    previewAssembledContext: ownerProcedure
      .input(
        z.object({
          chatId: z.string().optional(),
          stackId: z.string().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          return await previewAssembledContext(ctx.user.id, input)
        } catch (error) {
          mapError(error)
        }
      }),
  }),
})

export type AppRouter = typeof appRouter
