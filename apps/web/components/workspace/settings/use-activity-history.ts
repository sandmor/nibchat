"use client"

import { useEffect } from "react"
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { generationRetryDelay } from "@/components/workspace/stream-helpers"
import { useTRPC } from "@/lib/trpc-react"
import type {
  DiagnosticOutcome,
  DiagnosticKind,
} from "@/lib/diagnostic-contract"

type ActivityFilter = {
  kind?: DiagnosticKind
  outcome?: DiagnosticOutcome
  chatId?: string
  since?: string
  level?: "info" | "warn" | "error"
  limit: number
}

export function useActivityHistory(
  filter: ActivityFilter,
  streamAvailable: boolean
) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const list = trpc.workspace.activity.list
  const options = list.infiniteQueryOptions(filter, {
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  })
  const operations = useInfiniteQuery(options)
  const hasOlderPages = (operations.data?.pages.length ?? 0) > 1

  useEffect(() => {
    if (!streamAvailable || hasOlderPages || operations.isFetchingNextPage)
      return
    const queryKey = list.infiniteQueryKey(filter)
    const params = new URLSearchParams({ stream: "1" })
    for (const [key, value] of Object.entries(filter))
      if (key !== "limit" && value) params.set(key, String(value))
    let source: EventSource | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let disposed = false
    const connect = () => {
      if (disposed) return
      source = new EventSource(`/api/activity?${params}`)
      source.onopen = () => {
        attempts = 0
      }
      source.addEventListener("activity", (event) => {
        if (
          disposed ||
          queryClient.getQueryState(queryKey)?.fetchStatus === "fetching"
        )
          return
        const snapshot = JSON.parse((event as MessageEvent<string>).data)
        if (snapshot)
          queryClient.setQueryData(queryKey, (current) => {
            if (current && current.pages.length > 1) return current
            return { pages: [snapshot], pageParams: [null] }
          })
      })
      source.onerror = () => {
        source?.close()
        if (disposed) return
        attempts += 1
        retryTimer = setTimeout(connect, generationRetryDelay(attempts))
      }
    }
    connect()
    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      source?.close()
    }
  }, [
    filter,
    list,
    operations.isFetchingNextPage,
    hasOlderPages,
    queryClient,
    streamAvailable,
  ])

  const refresh = () =>
    queryClient.resetQueries({ queryKey: options.queryKey, exact: true })
  const loadOlder = async () => {
    if (!operations.hasNextPage || operations.isPlaceholderData) return
    const result = await operations.fetchNextPage({ cancelRefetch: false })
    if (result.isFetchNextPageError) throw result.error
  }
  return { operations, refresh, loadOlder }
}
