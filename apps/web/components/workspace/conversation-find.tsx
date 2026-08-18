"use client"

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react"
import { nextFindRevealPending } from "@/lib/conversation-search"
import {
  clearFindHighlights,
  paintMountedFindHighlights,
  revealPaintedFind,
} from "./find-highlight"

export type ConversationFindLayerValue = {
  query: string
  activeNodeId: string | null
  activeIndexInNode: number
  activeFindCount: number
  locateKey: number
}

export function ConversationFindLayer({
  value,
  children,
}: {
  value: ConversationFindLayerValue | null
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  const pendingRevealRef = useRef(0)
  const locateKeyRef = useRef(0)
  const rafRef = useRef(0)
  const findActive = value != null

  const syncHighlights = useCallback((reveal: boolean) => {
    const root = rootRef.current
    const currentValue = valueRef.current
    if (!root || !currentValue?.query) {
      clearFindHighlights()
      pendingRevealRef.current = 0
      return
    }
    const painted = paintMountedFindHighlights(root, currentValue)
    const pending = pendingRevealRef.current
    if (
      (reveal || pending === currentValue.locateKey) &&
      pending > 0 &&
      painted.activeArticle
    ) {
      pendingRevealRef.current = 0
      revealPaintedFind(painted.activeArticle, painted)
    }
  }, [])

  useLayoutEffect(() => {
    valueRef.current = value
    const locateKey = value?.locateKey ?? 0
    pendingRevealRef.current = nextFindRevealPending(
      locateKeyRef.current,
      locateKey,
      pendingRevealRef.current
    )
    locateKeyRef.current = locateKey
    if (!value?.query) {
      pendingRevealRef.current = 0
      clearFindHighlights()
      return
    }
    syncHighlights(true)
    return () => clearFindHighlights()
  }, [syncHighlights, value])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !findActive) return
    const observer = new MutationObserver(() => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        syncHighlights(false)
      })
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }
  }, [findActive, syncHighlights])

  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}
