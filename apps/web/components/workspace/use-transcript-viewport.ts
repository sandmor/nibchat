"use client"

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react"
import type { Virtualizer } from "@tanstack/react-virtual"
import {
  transcriptGeometryChanged,
  transcriptItemKey,
  type TranscriptRow,
} from "./chat-transcript-helpers"
import {
  createTranscriptViewport,
  transitionTranscriptViewport,
  transcriptAtEnd,
  transcriptViewportHandoff,
  TRANSCRIPT_OFFSET_EPSILON,
  type TranscriptLayout,
  type TranscriptLayoutRow,
  type TranscriptObservation,
  type TranscriptViewportEvent,
  type TranscriptViewportHandoff,
} from "./transcript-viewport-model"
import {
  registerTranscriptNavigation,
  type TranscriptElementNavigation,
} from "./transcript-navigation"
import { patchTranscriptLayoutRows } from "./transcript-viewport-geometry"

/** Live-edge flag for the scroll button. Listeners update that button alone. */
export type TranscriptAtEnd = {
  subscribe: (listener: () => void) => () => void
  get: () => boolean
  set: (value: boolean) => void
}

function createTranscriptAtEnd(): TranscriptAtEnd {
  let atEnd = true
  const listeners = new Set<() => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get() {
      return atEnd
    },
    set(value) {
      if (atEnd === value) return
      atEnd = value
      for (const listener of listeners) listener()
    },
  }
}

// Draft persistence changes mount/route identity, not the reader's conversation.
// Only serializable model data crosses that handoff; pending operations do not.
let createdChatViewport: {
  chatKey: string
  snapshot: TranscriptViewportHandoff
} | null = null

type Options = {
  chatKey: string
  creatingChat: boolean
  rows: readonly TranscriptRow[]
  layoutKey: string
  viewportRef: RefObject<HTMLDivElement | null>
  canvasRef: RefObject<HTMLDivElement | null>
  /** Column width for estimates. The adapter writes it; estimateSize only reads it. */
  widthRef: { current: number }
  /** Last virtualizer total. Scroll notifications share onChange and must not measure. */
  contentSizeRef: { current: number }
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>
  scrollTargetId: string | null
  findLocateKey: number
  onScrollTargetConsumed: () => void
  onRetainedSlotChange: (key: string | null) => void
  onSelect: (parentId: string, childId: string) => void | Promise<void>
}

/**
 * Browser adapter and command driver for the pure transcript UX contract.
 * Handlers report direction/measurements; ONLY transitionTranscriptViewport
 * chooses modes or offsets. Never restore scroll position merely for a render.
 */
export function useTranscriptViewport(options: Options) {
  const committed = useRef(options)
  const [initial] = useState(() =>
    createTranscriptViewport(
      createdChatViewport?.chatKey === options.chatKey
        ? createdChatViewport.snapshot
        : undefined
    )
  )
  const model = useRef(initial)
  const steppers = useRef(new Map<string, HTMLElement>())
  const running = useRef<{
    id: number
    offset: number
    behavior: "instant" | "smooth"
  } | null>(null)
  const mounted = useRef(false)
  const queued = useRef(false)
  const geometryEpoch = useRef(0)
  const publishedEpoch = useRef(-1)
  const publishedRows = useRef<readonly TranscriptRow[] | null>(null)
  const publishedWidth = useRef(-1)
  const viewportDirty = useRef(true)
  // The list must not re-render when the reader crosses the live edge.
  const [atEnd] = useState(createTranscriptAtEnd)

  const observation = useCallback((): TranscriptObservation => {
    const port = committed.current.viewportRef.current!
    return {
      offset: port.scrollTop,
      physicalMax: Math.max(0, port.scrollHeight - port.clientHeight),
      liveMax: Math.max(
        0,
        committed.current.virtualizer.getTotalSize() - port.clientHeight
      ),
    }
  }, [])

  const dispatch = useCallback(
    function dispatch(event: TranscriptViewportEvent) {
      const result = transitionTranscriptViewport(model.current, event)
      model.current = result.state
      for (const command of result.commands) {
        const { viewportRef, onRetainedSlotChange } = committed.current
        if (command.type === "retain") {
          onRetainedSlotChange(command.key)
          continue
        }
        const port = viewportRef.current!
        if (command.type === "stop-scroll") {
          if (running.current?.id === command.id) {
            running.current = null
            // Cancelling a native animation is a driver effect, not a new target.
            port.scrollTo({ top: port.scrollTop, behavior: "instant" })
          }
          continue
        }
        if (command.type === "scroll") {
          running.current = command
          // Sole outer scroll writer. Register provenance BEFORE the browser can
          // emit a scroll event; acknowledge rounding using the actual offset.
          port.scrollTo({ top: command.offset, behavior: command.behavior })
          const complete =
            command.behavior === "instant" ||
            Math.abs(port.scrollTop - command.offset) <=
              TRANSCRIPT_OFFSET_EPSILON
          if (complete) running.current = null
          dispatch({
            type: "applied",
            id: command.id,
            offset: port.scrollTop,
          })
          if (complete) dispatch({ type: "completed", id: command.id })
          continue
        }
        const exhaustive: never = command
        return exhaustive
      }
      const current = model.current
      if (current.layout)
        atEnd.set(
          transcriptAtEnd(
            current.offset,
            Math.max(
              0,
              current.layout.totalSize - current.layout.viewportHeight
            )
          )
        )
      if (committed.current.creatingChat)
        createdChatViewport = {
          chatKey: committed.current.chatKey,
          snapshot: transcriptViewportHandoff(current),
        }
    },
    [atEnd]
  )

  const observe = useCallback(() => {
    dispatch({
      type: "observed",
      observation: observation(),
      driverId: running.current?.id ?? null,
    })
  }, [dispatch, observation])

  const measure = useCallback(() => {
    const options = committed.current
    const port = options.viewportRef.current
    if (!port) return
    const { rows, virtualizer, widthRef, contentSizeRef } = options
    const previous = model.current.layout
    const pending = model.current.operation
    const waiting = pending?.kind === "waiting" ? pending.request : null
    const paddingStart = virtualizer.options.scrollPaddingStart
    const count = virtualizer.options.count
    // Parent commits and token growth both call this. Unchanged geometry has
    // nothing for the model to solve, so it must not read layout or walk rows.
    const settled =
      previous !== null &&
      waiting === null &&
      widthRef.current === publishedWidth.current &&
      geometryEpoch.current === publishedEpoch.current &&
      previous.paddingStart === paddingStart &&
      previous.rows.length === count
    const idle = settled && rows === publishedRows.current
    if (idle && !viewportDirty.current) return

    const viewportHeight = viewportDirty.current
      ? port.clientHeight
      : (previous?.viewportHeight ?? port.clientHeight)
    viewportDirty.current = false
    if (idle && previous !== null && previous.viewportHeight === viewportHeight)
      return
    // A new row array with the same slot geometry is not a layout. Adopting
    // it keeps the next commit on the idle path and avoids a scrollport read.
    if (
      settled &&
      previous !== null &&
      publishedRows.current !== null &&
      previous.viewportHeight === viewportHeight &&
      !transcriptGeometryChanged(publishedRows.current, rows)
    ) {
      publishedRows.current = rows
      return
    }

    const totalSize = virtualizer.getTotalSize()
    contentSizeRef.current = totalSize
    const flat = flatMeasurements(virtualizer)
    const versionSlot = waiting?.kind === "version" ? waiting.slotKey : null
    // Mount facts (measured, stepper) are only read while a reveal is waiting.
    // Streaming growth keeps the previous row objects and patches changed boxes.
    const needsMount =
      waiting?.kind === "message" || waiting?.kind === "version"
    const sameRows =
      previous !== null &&
      previous.rows.length === count &&
      rows === publishedRows.current &&
      widthRef.current === publishedWidth.current &&
      !needsMount
    const patched =
      sameRows && flat
        ? patchTranscriptLayoutRows(previous.rows, flat, count)
        : null
    const layoutRows =
      patched ??
      buildLayoutRows({
        rows,
        count,
        flat,
        virtualizer,
        steppers: steppers.current,
        versionSlot,
      })
    if (
      previous &&
      layoutRows === previous.rows &&
      previous.totalSize === totalSize &&
      previous.viewportHeight === viewportHeight &&
      previous.paddingStart === paddingStart
    ) {
      publishedEpoch.current = geometryEpoch.current
      // A rebuild that reproduced the same boxes can still carry a browser clamp.
      if (
        Math.abs(port.scrollTop - model.current.offset) >
        TRANSCRIPT_OFFSET_EPSILON
      )
        observe()
      return
    }
    publishedRows.current = rows
    publishedWidth.current = widthRef.current
    publishedEpoch.current = geometryEpoch.current
    const layout: TranscriptLayout = {
      totalSize,
      viewportHeight,
      paddingStart,
      rows: layoutRows,
    }
    // The model consumes unreported native movement against its OLD geometry
    // before applying this layout. No scroll-event/React-commit order is assumed.
    dispatch({
      type: "layout",
      layout,
      observation: observation(),
      driverId: running.current?.id ?? null,
    })
  }, [dispatch, observation])

  const notifyMeasurements = useCallback(
    (geometry = true) => {
      if (geometry) geometryEpoch.current += 1
      if (queued.current) return
      queued.current = true
      queueMicrotask(() => {
        queued.current = false
        if (mounted.current) measure()
      })
    },
    [measure]
  )

  const registerStepper = useCallback(
    (key: string, element: HTMLElement | null) => {
      if (element) steppers.current.set(key, element)
      else steppers.current.delete(key)
    },
    []
  )

  const selectVersion = useCallback(
    async (slotKey: string, parentId: string, messageId: string) => {
      observe()
      const port = committed.current.viewportRef.current!
      const stepper = steppers.current.get(slotKey)!
      const id = model.current.nextId
      dispatch({
        type: "request",
        request: {
          kind: "version",
          slotKey,
          messageId,
          viewportY:
            stepper.getBoundingClientRect().top -
            port.getBoundingClientRect().top,
        },
      })
      try {
        await committed.current.onSelect(parentId, messageId)
      } catch {
        // The mutation reports/rolls back data; the model cancels this operation
        // only if it is still current. A late failure cannot affect a newer click.
        if (mounted.current) dispatch({ type: "failed", id })
      }
    },
    [dispatch, observe]
  )

  const jumpToEnd = useCallback(() => {
    observe()
    dispatch({ type: "jump-to-end" })
  }, [dispatch, observe])

  const navigateElement = useCallback(
    ({ target, align, behavior, bounds }: TranscriptElementNavigation) => {
      observe()
      const port = committed.current.viewportRef.current!
      const rect = bounds ?? target.getBoundingClientRect()
      const origin = port.getBoundingClientRect().top
      dispatch({
        type: "request",
        request: {
          kind: "bounds",
          top: port.scrollTop + rect.top - origin,
          bottom: port.scrollTop + rect.bottom - origin,
          align,
          behavior: behavior === "smooth" ? "smooth" : "instant",
        },
      })
    },
    [dispatch, observe]
  )

  const prepareChat = useCallback(
    (chatKey: string) => {
      observe()
      dispatch({ type: "handoff" })
      createdChatViewport = {
        chatKey,
        snapshot: transcriptViewportHandoff(model.current),
      }
    },
    [dispatch, observe]
  )

  useLayoutEffect(() => {
    const previous = committed.current
    committed.current = options
    if (
      !options.creatingChat &&
      createdChatViewport?.chatKey === options.chatKey
    )
      createdChatViewport = null
    const { virtualizer, canvasRef, widthRef } = options
    const canvas = canvasRef.current
    let rebuild = false
    if (canvas && widthRef.current === 0) {
      const nextWidth = Math.round(canvas.clientWidth)
      if (nextWidth > 0) {
        widthRef.current = nextWidth
        rebuild = true
      }
    }
    // Row identity is stable across unrelated commits. Geometry strings are
    // only built when that identity actually changes.
    if (
      previous.layoutKey !== options.layoutKey ||
      (previous.rows !== options.rows &&
        transcriptGeometryChanged(previous.rows, options.rows))
    )
      rebuild = true
    if (rebuild && canvas) {
      virtualizer.measure()
      for (const element of canvas.querySelectorAll<HTMLDivElement>(
        ":scope > [data-index]"
      ))
        virtualizer.measureElement(element)
    }
    // Child refs/layout effects have measured the committed replacement here.
    // A ready version alignment is applied before paint, then consumed once.
    measure()
  })

  const { scrollTargetId, findLocateKey, onScrollTargetConsumed } = options
  useLayoutEffect(() => {
    if (!scrollTargetId) return
    observe()
    dispatch({
      type: "request",
      request: { kind: "message", messageId: scrollTargetId },
    })
    onScrollTargetConsumed()
  }, [scrollTargetId, findLocateKey, onScrollTargetConsumed, dispatch, observe])

  useLayoutEffect(() => {
    mounted.current = true
    const { viewportRef, canvasRef, virtualizer } = committed.current
    const port = viewportRef.current!
    const canvas = canvasRef.current!
    const unregister = registerTranscriptNavigation(port, {
      navigate: navigateElement,
      prepareChat,
    })
    if (!committed.current.creatingChat) createdChatViewport = null
    const input = (direction: "away" | "toward" | "none") => {
      dispatch({ type: "input", direction, observation: observation() })
    }
    // overflow-y is stable for a mounted node. scrollHeight stays live so a
    // block that grows into a scroller starts consuming the gesture.
    const overflowScroll = new WeakMap<Element, boolean>()
    const scrollsViewport = (target: EventTarget | null) => {
      let element = target instanceof Element ? target : null
      if (!element && target instanceof Node) element = target.parentElement
      for (
        let current = element;
        current && current !== port;
        current = current.parentElement
      ) {
        let scrolls = overflowScroll.get(current)
        if (scrolls === undefined) {
          scrolls = /auto|scroll/.test(getComputedStyle(current).overflowY)
          overflowScroll.set(current, scrolls)
        }
        if (scrolls && current.scrollHeight > current.clientHeight) return false
      }
      return true
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !scrollsViewport(event.target)) return
      input(event.deltaY < 0 ? "away" : event.deltaY > 0 ? "toward" : "none")
    }
    let touchY: number | null = null
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches.length === 1 ? event.touches[0]!.clientY : null
    }
    const onTouchMove = (event: TouchEvent) => {
      if (touchY === null || event.touches.length !== 1) return
      const nextY = event.touches[0]!.clientY
      const delta = touchY - nextY
      touchY = nextY
      if (scrollsViewport(event.target))
        input(delta < 0 ? "away" : delta > 0 ? "toward" : "none")
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target as Element).closest(
          "input, textarea, select, button, [contenteditable='true']"
        )
      )
        return
      const away =
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      const toward =
        ["ArrowDown", "PageDown", "End"].includes(event.key) ||
        (event.key === " " && !event.shiftKey)
      if (away || toward) input(away ? "away" : "toward")
    }
    const onPointerDown = (event: PointerEvent) => {
      const gutter = port.offsetWidth - port.clientWidth
      if (
        gutter > 0 &&
        event.clientX >= port.getBoundingClientRect().right - gutter
      )
        dispatch({ type: "control-started", observation: observation() })
    }
    const onScroll = () => observe()
    const onScrollEnd = () => {
      const active = running.current
      if (!active) return
      const target = Math.min(
        active.offset,
        Math.max(0, port.scrollHeight - port.clientHeight)
      )
      // A cancelled animation can deliver scrollend after a newer command starts.
      // Only acknowledge the current command once its physical target is reached.
      if (Math.abs(port.scrollTop - target) > TRANSCRIPT_OFFSET_EPSILON) return
      measure()
      running.current = null
      dispatch({
        type: "applied",
        id: active.id,
        offset: port.scrollTop,
      })
      dispatch({ type: "completed", id: active.id })
    }
    port.addEventListener("wheel", onWheel, { passive: true })
    port.addEventListener("touchstart", onTouchStart, { passive: true })
    port.addEventListener("touchmove", onTouchMove, { passive: true })
    port.addEventListener("keydown", onKeyDown)
    port.addEventListener("pointerdown", onPointerDown)
    port.addEventListener("scroll", onScroll, { passive: true })
    port.addEventListener("scrollend", onScrollEnd)
    const { widthRef } = committed.current
    let width = widthRef.current
    const observer = new ResizeObserver((entries) => {
      let widthChanged = false
      let viewportChanged = false
      for (const entry of entries) {
        if (entry.target === canvas) {
          const box = entry.borderBoxSize?.[0]
          const nextWidth = Math.round(
            box?.inlineSize ?? entry.contentRect.width
          )
          if (nextWidth !== width) {
            width = nextWidth
            widthRef.current = nextWidth
            widthChanged = true
          }
          // Canvas height follows item measurement, which already notified.
        } else {
          viewportChanged = true
        }
      }
      if (widthChanged) {
        geometryEpoch.current += 1
        virtualizer.measure()
        for (const element of canvas.querySelectorAll<HTMLDivElement>(
          ":scope > [data-index]"
        ))
          virtualizer.measureElement(element)
      }
      if (viewportChanged) viewportDirty.current = true
      // Item measurement notifies on its own. Viewport-only changes must not
      // look like a new row geometry epoch.
      if (viewportChanged || widthChanged) notifyMeasurements(false)
    })
    observer.observe(canvas)
    observer.observe(port)
    return () => {
      mounted.current = false
      unregister()
      observer.disconnect()
      // A detached browser animation has no authority over another mount.
      running.current = null
      port.removeEventListener("wheel", onWheel)
      port.removeEventListener("touchstart", onTouchStart)
      port.removeEventListener("touchmove", onTouchMove)
      port.removeEventListener("keydown", onKeyDown)
      port.removeEventListener("pointerdown", onPointerDown)
      port.removeEventListener("scroll", onScroll)
      port.removeEventListener("scrollend", onScrollEnd)
    }
  }, [
    dispatch,
    measure,
    navigateElement,
    notifyMeasurements,
    observation,
    observe,
    prepareChat,
  ])

  return {
    atEnd,
    notifyMeasurements,
    registerStepper,
    selectVersion,
    jumpToEnd,
  }
}

function flatMeasurements(
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>
): Float64Array | null {
  const flat = (
    virtualizer as unknown as { _flatMeasurements?: Float64Array | null }
  )._flatMeasurements
  if (!flat || flat.length < virtualizer.options.count * 2) return null
  return flat
}

function buildLayoutRows(input: {
  rows: readonly TranscriptRow[]
  count: number
  flat: Float64Array | null
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>
  steppers: Map<string, HTMLElement>
  versionSlot: string | null
}): TranscriptLayoutRow[] {
  const { rows, count, flat, virtualizer, steppers, versionSlot } = input
  const layout: TranscriptLayoutRow[] = []
  for (let index = 0; index < count; index++) {
    const key = transcriptItemKey(rows, index)
    const cached = flat ? undefined : virtualizer.measurementsCache[index]
    const start = flat ? flat[index * 2]! : cached!.start
    const size = flat ? flat[index * 2 + 1]! : cached!.size
    let stepperOffset: number | null = null
    if (versionSlot === key) {
      const element = virtualizer.elementsCache.get(key)
      const stepper = steppers.get(key)
      if (element && stepper)
        stepperOffset =
          stepper.getBoundingClientRect().top -
          element.getBoundingClientRect().top
    }
    layout.push({
      key,
      start,
      size,
      messageId: rows[index]?.messageId ?? null,
      measured: virtualizer.elementsCache.has(key),
      stepperOffset,
    })
  }
  return layout
}
