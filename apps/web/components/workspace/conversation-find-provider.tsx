"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useConversationFindSession } from "./conversation-find-session"

const FindContext = createContext<ReturnType<
  typeof useConversationFindSession
> | null>(null)

export function ConversationFindProvider({
  options,
  children,
}: {
  options: Parameters<typeof useConversationFindSession>[0]
  children?: ReactNode
}) {
  const find = useConversationFindSession(options)
  return <FindContext.Provider value={find}>{children}</FindContext.Provider>
}

export function useConversationFind() {
  const find = useContext(FindContext)
  if (!find) throw new Error("Conversation Find requires its provider")
  return find
}
