import { afterEach, describe, expect, it, vi } from "vitest"
import {
  abortGenerations,
  clearActiveGenerations,
  isGenerationActive,
  registerGeneration,
  unregisterGeneration,
} from "@/lib/active-generations"

afterEach(() => {
  clearActiveGenerations()
})

describe("active-generations", () => {
  it("registers and unregisters a generation", () => {
    const controller = new AbortController()
    registerGeneration("n1", controller)
    expect(isGenerationActive("n1")).toBe(true)
    unregisterGeneration("n1")
    expect(isGenerationActive("n1")).toBe(false)
  })

  it("aborts registered generations and returns the count", () => {
    const a = new AbortController()
    const b = new AbortController()
    const spyA = vi.spyOn(a, "abort")
    const spyB = vi.spyOn(b, "abort")
    registerGeneration("a", a)
    registerGeneration("b", b)
    expect(abortGenerations(["a", "missing", "b"])).toBe(2)
    expect(spyA).toHaveBeenCalledOnce()
    expect(spyB).toHaveBeenCalledOnce()
    expect(isGenerationActive("a")).toBe(false)
    expect(isGenerationActive("b")).toBe(false)
  })

  it("double unregister and abort are safe", () => {
    const controller = new AbortController()
    registerGeneration("x", controller)
    unregisterGeneration("x")
    unregisterGeneration("x")
    expect(abortGenerations(["x"])).toBe(0)
  })

  it("replacing a registration aborts the previous controller", () => {
    const first = new AbortController()
    const second = new AbortController()
    const spy = vi.spyOn(first, "abort")
    registerGeneration("n", first)
    registerGeneration("n", second)
    expect(spy).toHaveBeenCalledOnce()
    expect(isGenerationActive("n")).toBe(true)
    expect(abortGenerations(["n"])).toBe(1)
    expect(second.signal.aborted).toBe(true)
  })
})
