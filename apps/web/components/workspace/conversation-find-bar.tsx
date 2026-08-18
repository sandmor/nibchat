"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type FindResultRow = {
  nodeId: string
  role: string
  onPath: boolean
  snippet: string
}

type MotionTransition = {
  duration: number
  ease: [number, number, number, number]
}

export function ConversationFindBar({
  view,
  query,
  onQueryChange,
  focusNonce,
  current,
  total,
  onPrev,
  onNext,
  onClose,
  pathCount,
  offPathCount,
  onShowInTree,
  onJump,
  showUseThisPath,
  onUseThisPath,
  results,
  activeNodeId,
  onSelectResult,
  animate,
  transition,
}: {
  view: "linear" | "tree"
  query: string
  onQueryChange: (query: string) => void
  focusNonce: number
  current: number
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  pathCount: number
  offPathCount: number
  onShowInTree?: () => void
  onJump?: () => void
  showUseThisPath: boolean
  onUseThisPath?: () => void
  results: FindResultRow[] | null
  activeNodeId: string | null
  onSelectResult?: (nodeId: string) => void
  animate: boolean
  transition: MotionTransition
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [boundQuery, setBoundQuery] = useState(query)
  if (query !== boundQuery) {
    setBoundQuery(query)
    setResultsOpen(false)
  }
  const motionTransition = animate ? transition : { duration: 0 }

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [focusNonce])

  const countLabel = total === 0 ? "0 / 0" : `${current} / ${total}`
  const resultRows = results && results.length > 0 ? results : null
  const showOffPath = Boolean(offPathCount > 0 && onShowInTree && onJump)
  const showPathAction = Boolean(showUseThisPath && onUseThisPath)

  return (
    <motion.div
      key="conversation-find"
      data-conversation-find
      data-testid="conversation-find"
      initial={animate ? { scale: 0.86, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.86, opacity: 0 }}
      transition={motionTransition}
      className={cn(
        "absolute z-30 rounded-xl border bg-[var(--tree-chrome-background)] p-2 shadow-[var(--tree-shadow-sm)] backdrop-blur",
        view === "tree"
          ? "top-3 right-14 left-3 origin-top-left sm:right-auto sm:w-[min(28rem,calc(100%-1.5rem))]"
          : "top-3 right-3 left-3 origin-top sm:left-auto sm:w-[min(28rem,calc(100%-1.5rem))] sm:origin-top-right"
      )}
    >
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Find in conversation"
            aria-label="Find in conversation"
            data-find-input=""
            className="h-8 pl-7 text-sm"
          />
        </div>
        <span
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {countLabel}
        </span>
        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Previous match"
            disabled={total === 0}
            onClick={onPrev}
          >
            <HugeiconsIcon icon={ArrowUp01Icon} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Next match"
            disabled={total === 0}
            onClick={onNext}
          >
            <HugeiconsIcon icon={ArrowDown01Icon} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Close find"
            onClick={onClose}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
          </Button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {showOffPath ? (
          <motion.div
            key="off-path"
            initial={animate ? { height: 0, opacity: 0 } : false}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={motionTransition}
            className="overflow-hidden"
          >
            <div className="mt-2 flex items-center gap-1.5 rounded-lg px-0.5 text-xs">
              <span className="text-muted-foreground whitespace-nowrap">
                {pathCount} on this path
              </span>
              <span aria-hidden className="h-3 w-px shrink-0 bg-border" />
              <span className="text-muted-foreground whitespace-nowrap">
                {offPathCount} on other branches
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onShowInTree}
              >
                Show in tree
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={onJump}>
                Jump
              </Button>
            </div>
          </motion.div>
        ) : null}
        {showPathAction ? (
          <motion.div
            key="use-path"
            initial={animate ? { height: 0, opacity: 0 } : false}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={motionTransition}
            className="overflow-hidden"
          >
            <div className="mt-2">
              <Button type="button" size="xs" onClick={onUseThisPath}>
                Use this path
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {resultRows ? (
        <div className="mt-2">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="w-full justify-between"
            aria-expanded={resultsOpen}
            onClick={() => setResultsOpen((expanded) => !expanded)}
          >
            <span>
              {resultRows.length}{" "}
              {resultRows.length === 1 ? "message" : "messages"}
            </span>
            <HugeiconsIcon
              icon={resultsOpen ? ArrowUp01Icon : ArrowDown01Icon}
              className="size-3.5"
            />
          </Button>
          <AnimatePresence initial={false}>
            {resultsOpen ? (
              <motion.div
                key="results"
                initial={animate ? { height: 0, opacity: 0 } : false}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={motionTransition}
                className="overflow-hidden"
              >
                <ul className="mt-1 max-h-[min(16rem,40vh)] space-y-0.5 overflow-auto">
                  {resultRows.map((row) => (
                    <li key={row.nodeId}>
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted",
                          activeNodeId === row.nodeId && "bg-muted"
                        )}
                        onClick={() => onSelectResult?.(row.nodeId)}
                      >
                        <span className="shrink-0 font-medium capitalize">
                          {row.role}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {row.snippet}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-px text-[10px] uppercase",
                            row.onPath
                              ? "bg-muted text-muted-foreground"
                              : "bg-secondary text-secondary-foreground"
                          )}
                        >
                          {row.onPath ? "On path" : "Off path"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
    </motion.div>
  )
}
