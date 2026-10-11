"use client"

import { QueryClient } from "@tanstack/react-query"
import { reportActionError } from "@/lib/action-errors"

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        onError: (error) => reportActionError(error),
      },
      queries: {
        staleTime: 30_000,
      },
    },
  })
}
