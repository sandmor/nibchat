import { describe, expect, it } from "vitest"
import { cssColorToHex, hexToOklchCss } from "@/lib/appearance-color"

describe("appearance-color", () => {
  it("maps hex and oklch into picker hex", () => {
    expect(cssColorToHex("#ff0000").toLowerCase()).toBe("#ff0000")
    expect(cssColorToHex("#f00").toLowerCase()).toBe("#ff0000")
    expect(cssColorToHex("oklch(1 0 0)").toLowerCase()).toMatch(/^#[0-9a-f]{6}$/)
    expect(cssColorToHex(undefined, "#112233")).toBe("#112233")
    expect(cssColorToHex("not-a-color", "#112233")).toBe("#112233")
  })

  it("writes oklch from picker hex and round-trips near-black", () => {
    const css = hexToOklchCss("#000000")
    expect(css.startsWith("oklch(")).toBe(true)
    const hex = cssColorToHex(css).toLowerCase()
    // very dark gray / black after oklch→hex
    expect(hex.length).toBe(7)
    expect(parseInt(hex.slice(1, 3), 16)).toBeLessThan(8)
    expect(parseInt(hex.slice(3, 5), 16)).toBeLessThan(8)
    expect(parseInt(hex.slice(5, 7), 16)).toBeLessThan(8)
  })

  it("produces stable compact oklch for saturated colors", () => {
    const css = hexToOklchCss("#ff0000")
    expect(css).toMatch(/^oklch\([0-9.]+ [0-9.]+ [0-9.]+\)$/)
  })
})
