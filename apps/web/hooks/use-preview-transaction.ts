"use client"

import { useCallback, useLayoutEffect, useRef } from "react"

type PreviewTransactionOptions<T> = {
  publish: (value: T) => void
  commit: () => void
  discard: () => void
  commitDelayMs?: number
}

/**
 * Coalesces high-frequency preview values to animation frames and owns the
 * commit/discard lifecycle. An optional trailing delay supports controls (such
 * as native color inputs) that do not expose a reliable drag-end event.
 */
export function usePreviewTransaction<T>({
  publish,
  commit,
  discard,
  commitDelayMs,
}: PreviewTransactionOptions<T>) {
  const publishRef = useRef(publish)
  const commitRef = useRef(commit)
  const discardRef = useRef(discard)
  const delayRef = useRef(commitDelayMs)
  const pendingRef = useRef<T | undefined>(undefined)
  const hasPendingRef = useRef(false)
  const activeRef = useRef(false)
  const frameRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useLayoutEffect(() => {
    publishRef.current = publish
    commitRef.current = commit
    discardRef.current = discard
    delayRef.current = commitDelayMs
  }, [commit, commitDelayMs, discard, publish])

  const clearScheduledWork = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const publishPending = useCallback(() => {
    if (!hasPendingRef.current) return
    hasPendingRef.current = false
    const value = pendingRef.current as T
    pendingRef.current = undefined
    publishRef.current(value)
  }, [])

  const commitNow = useCallback(() => {
    if (!activeRef.current) return
    clearScheduledWork()
    publishPending()
    activeRef.current = false
    commitRef.current()
  }, [clearScheduledWork, publishPending])

  const discardNow = useCallback(() => {
    clearScheduledWork()
    pendingRef.current = undefined
    hasPendingRef.current = false
    if (!activeRef.current) return
    activeRef.current = false
    discardRef.current()
  }, [clearScheduledWork])

  const schedule = useCallback(
    (value: T) => {
      pendingRef.current = value
      hasPendingRef.current = true
      activeRef.current = true

      if (frameRef.current == null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null
          publishPending()
        })
      }

      if (timerRef.current != null) clearTimeout(timerRef.current)
      const delay = delayRef.current
      if (delay != null) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          commitNow()
        }, delay)
      }
    },
    [commitNow, publishPending]
  )

  useLayoutEffect(() => discardNow, [discardNow])

  return {
    schedule,
    commit: commitNow,
    discard: discardNow,
  }
}
