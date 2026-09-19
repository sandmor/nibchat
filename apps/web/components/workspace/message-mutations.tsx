"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react"
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import type { inferRouterInputs } from "@trpc/server"
import { toast } from "sonner"
import type { AppRouter } from "@/lib/trpc"
import { useTRPC, useTRPCClient } from "@/lib/trpc-react"
import { patchContextExcluded, type WorkspaceData } from "@/lib/workspace-cache"
import { retainStaticTooltips } from "@/lib/static-tooltips"

type WorkspaceMutationInputs = inferRouterInputs<AppRouter>["workspace"]

export type MessageMutationOperation =
  | { kind: "fork"; input: WorkspaceMutationInputs["forkMessageParts"] }
  | { kind: "replace"; input: WorkspaceMutationInputs["replaceMessage"] }
  | { kind: "delete"; input: WorkspaceMutationInputs["deleteNode"] }
  | { kind: "move"; input: WorkspaceMutationInputs["moveNode"] }
  | {
      kind: "context"
      chatId: string
      input: WorkspaceMutationInputs["setContextExcluded"]
    }

type MessageMutationContext = {
  previous?: WorkspaceData
  key?: QueryKey
}

type MessageMutationController = {
  execute: (operation: MessageMutationOperation) => Promise<unknown>
}

const Context = createContext<MessageMutationController | null>(null)

function errorFallback(kind: MessageMutationOperation["kind"]) {
  switch (kind) {
    case "fork":
      return "Could not save message branch"
    case "replace":
      return "Could not replace message"
    case "delete":
      return "Delete failed"
    case "move":
      return "Could not move message"
    case "context":
      return "Could not update message context"
  }
}

/** One mutation observer services every mounted message in the active view. */
export function MessageMutationProvider({ children }: { children: ReactNode }) {
  useEffect(() => retainStaticTooltips(), [])
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()
  const mutation = useMutation<
    unknown,
    Error,
    MessageMutationOperation,
    MessageMutationContext
  >({
    mutationFn: async (operation) => {
      switch (operation.kind) {
        case "fork":
          return await trpcClient.workspace.forkMessageParts.mutate(
            operation.input
          )
        case "replace":
          return await trpcClient.workspace.replaceMessage.mutate(
            operation.input
          )
        case "delete":
          return await trpcClient.workspace.deleteNode.mutate(operation.input)
        case "move":
          return await trpcClient.workspace.moveNode.mutate(operation.input)
        case "context":
          return await trpcClient.workspace.setContextExcluded.mutate(
            operation.input
          )
      }
    },
    onMutate: async (operation) => {
      if (operation.kind !== "context") return {}
      const key = trpc.workspace.get.queryKey({ chatId: operation.chatId })
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<WorkspaceData>(key)
      queryClient.setQueryData(
        key,
        patchContextExcluded(
          previous,
          operation.input.nodeId,
          operation.input.excluded
        )
      )
      return { previous, key }
    },
    onError: (error, operation, context) => {
      if (operation.kind === "context" && context?.previous && context.key)
        queryClient.setQueryData(context.key, context.previous)
      toast.error(error.message || errorFallback(operation.kind))
    },
    onSettled: async (_data, _error, operation, context) => {
      if (operation.kind === "context" && context?.key)
        await queryClient.invalidateQueries({ queryKey: context.key })
    },
  })
  const value = useMemo(
    () => ({ execute: mutation.mutateAsync }),
    [mutation.mutateAsync]
  )

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useMessageMutationController() {
  const value = useContext(Context)
  if (!value)
    throw new Error(
      "useMessageMutationController must be used inside MessageMutationProvider"
    )
  return value
}
