// @vitest-environment jsdom

import { act, createElement, Fragment } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usePreviewTransaction } from "@/hooks/use-preview-transaction"

function Harness({
  publish,
  commit,
  discard,
  delay,
}: {
  publish: (value: string) => void
  commit: () => void
  discard: () => void
  delay?: number
}) {
  const transaction = usePreviewTransaction({
    publish,
    commit,
    discard,
    commitDelayMs: delay,
  })
  return createElement(
    Fragment,
    null,
    createElement("button", {
      id: "first",
      onClick: () => transaction.schedule("first"),
    }),
    createElement("button", {
      id: "second",
      onClick: () => transaction.schedule("second"),
    }),
    createElement("button", { id: "commit", onClick: transaction.commit })
  )
}

describe("usePreviewTransaction", () => {
  let container: HTMLDivElement
  let root: Root
  let mounted: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    )
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id)
    )
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mounted = true
  })

  afterEach(() => {
    if (mounted) act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function renderHarness(
    publish: (value: string) => void,
    commit: () => void,
    discard: () => void,
    delay?: number
  ) {
    act(() =>
      root.render(createElement(Harness, { publish, commit, discard, delay }))
    )
  }

  it("publishes the latest value once per frame and commits after idle", () => {
    const publish = vi.fn()
    const commit = vi.fn()
    const discard = vi.fn()
    renderHarness(publish, commit, discard, 180)

    act(() => {
      container.querySelector<HTMLButtonElement>("#first")!.click()
      container.querySelector<HTMLButtonElement>("#second")!.click()
    })
    expect(publish).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(16))
    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenLastCalledWith("second")
    expect(commit).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(164))
    expect(commit).toHaveBeenCalledOnce()
    expect(discard).not.toHaveBeenCalled()
  })

  it("flushes a pending value on explicit commit", () => {
    const publish = vi.fn()
    const commit = vi.fn()
    const discard = vi.fn()
    renderHarness(publish, commit, discard)

    act(() => {
      container.querySelector<HTMLButtonElement>("#first")!.click()
      container.querySelector<HTMLButtonElement>("#commit")!.click()
    })

    expect(publish).toHaveBeenCalledWith("first")
    expect(commit).toHaveBeenCalledOnce()
    expect(discard).not.toHaveBeenCalled()
  })

  it("discards active work on unmount", () => {
    const publish = vi.fn()
    const commit = vi.fn()
    const discard = vi.fn()
    renderHarness(publish, commit, discard)
    act(() => container.querySelector<HTMLButtonElement>("#first")!.click())

    act(() => root.unmount())
    mounted = false

    expect(publish).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(discard).toHaveBeenCalledOnce()
  })
})
