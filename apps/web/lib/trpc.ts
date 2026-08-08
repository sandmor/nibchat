import "server-only"
import { initTRPC, TRPCError } from "@trpc/server"
import { z } from "zod"
import { requireOwner } from "@/lib/auth"
import {
  createChat,
  createProvider,
  deleteChat,
  deleteNode,
  deleteProvider,
  forkEdit,
  getInstanceSettings,
  getWorkspace,
  searchChats,
  selectChild,
  selectPath,
  selectRoot,
  setAppearance,
  updateChat,
  updateProvider,
  updateSystemPrompt,
} from "@/lib/chat-service"
import { listProviders } from "@/lib/providers"
import { appearanceSchema } from "@/lib/appearance"

export async function createContext({ req }: { req: Request }) {
  try {
    return {
      user: await requireOwner(req.headers),
      authError: null as string | null,
    }
  } catch (error) {
    return {
      user: null,
      authError: error instanceof Error ? error.message : "Unauthorized",
    }
  }
}

const t = initTRPC.context<typeof createContext>().create()
const ownerProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    if (ctx.authError === "This account is not the instance owner")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ctx.authError,
      })
    throw new TRPCError({ code: "UNAUTHORIZED" })
  }
  return next({ ctx: { user: ctx.user } })
})

const partsSchema = z.array(
  z.object({ type: z.enum(["text", "reasoning"]), text: z.string() })
)
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
          })
          .optional()
      )
      .mutation(({ ctx, input }) =>
        createChat(ctx.user.id, input?.title, input?.config)
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
    updateSystemPrompt: ownerProcedure
      .input(z.object({ systemPrompt: z.string().max(20_000) }))
      .mutation(async ({ input }) => {
        await updateSystemPrompt(input.systemPrompt)
        return { ok: true }
      }),
  }),
})

export type AppRouter = typeof appRouter
