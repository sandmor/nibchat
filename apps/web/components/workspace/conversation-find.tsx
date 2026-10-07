"use client"

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react"
import { nextFindRevealPending } from "@/lib/conversation-search"
import {
  clearFindHighlights,
  paintMountedFindHighlights,
  revealPaintedFind,
  type FindPaintCache,
  type FindPaintValue,
} from "./find-highlight"

export type ConversationFindLayerValue = FindPaintValue & { locateKey: number }

export function ConversationFindLayer({
  value,
  children,
}: {
  value: ConversationFindLayerValue | null
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const valueRef = useRef(value)
  const previousRef = useRef<ConversationFindLayerValue | null>(null)
  const pendingRevealRef = useRef(0)
  const cacheRef = useRef<FindPaintCache>(new Map())
  const dirtyRef = useRef(new Set<HTMLElement>())
  const fullRef = useRef(true)
  const rafRef = useRef(0)
  const findActive = value != null

  const schedule = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const root = rootRef.current
      const current = valueRef.current
      if (!root || !current) return
      const painted = paintMountedFindHighlights(
        root,
        current,
        cacheRef.current,
        fullRef.current ? undefined : dirtyRef.current
      )
      fullRef.current = false
      dirtyRef.current.clear()
      if (pendingRevealRef.current > 0 && painted.activeArticle) {
        pendingRevealRef.current = 0
        revealPaintedFind(painted.activeArticle, painted)
      }
    })
  }, [])

  useLayoutEffect(() => {
    const previous = previousRef.current
    previousRef.current = value
    valueRef.current = value
    pendingRevealRef.current = nextFindRevealPending(
      previous?.locateKey ?? 0,
      value?.locateKey ?? 0,
      pendingRevealRef.current
    )
    if (!value) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      cacheRef.current.clear()
      dirtyRef.current.clear()
      fullRef.current = true
      clearFindHighlights()
      return
    }
    if (previous?.query !== value.query) fullRef.current = true
    // Navigation and index changes affect the old and new active messages only.
    for (const id of [previous?.activeNodeId, value.activeNodeId]) {
      if (!id) continue
      const article = [...cacheRef.current.keys()].find(
        (element) => element.getAttribute("data-find-node") === id
      )
      if (article) dirtyRef.current.add(article)
    }
    schedule()
  }, [value, schedule])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !findActive) return
    const markArticle = (target: Node) => {
      const element = target instanceof Element ? target : target.parentElement
      const article = element?.closest<HTMLElement>("[data-find-node]")
      if (article) dirtyRef.current.add(article)
    }
    const onEditor = (event: Event) => {
      if (event.target instanceof Node) markArticle(event.target)
      schedule()
    }
    root.addEventListener("conversation-find-editor-update", onEditor)
    const observer = new MutationObserver((records) => {
      let changed = false
      for (const record of records) {
        const element =
          record.target instanceof Element
            ? record.target
            : record.target.parentElement
        if (element?.closest(".cm-editor,[data-find-skip]")) continue
        markArticle(record.target)
        changed = true
        for (const node of [...record.addedNodes, ...record.removedNodes]) {
          if (!(node instanceof HTMLElement)) continue
          if (node.matches("[data-find-node]")) dirtyRef.current.add(node)
          for (const article of node.querySelectorAll<HTMLElement>(
            "[data-find-node]"
          ))
            dirtyRef.current.add(article)
        }
      }
      if (changed) schedule()
    })
    observer.observe(root, {
      childList: true,
      subtree: true,
    })
    return () => {
      root.removeEventListener("conversation-find-editor-update", onEditor)
      observer.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [findActive, schedule])

  useLayoutEffect(() => () => clearFindHighlights(), [])
  return (
    <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  )
}
