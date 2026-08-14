import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultAppearance, parseAppearance, patchToken } from "@/lib/appearance"
import {
  APPEARANCE_MAGIC_LS_KEY,
  MAGIC_PERSIST_DEBOUNCE_MS,
  flushMagicPersist,
  isAppearanceDirty,
  parseMagicPersist,
  resetMagicPersistRuntime,
  serializeMagicPersist,
  useAppearanceStore,
} from "@/lib/appearance-store"

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
    key: (i) => [...map.keys()][i] ?? null,
  }
}

describe("appearance-store pure helpers", () => {
  it("detects dirty via appearanceToJson", () => {
    const a = defaultAppearance()
    const b = patchToken(a, "--sidebar", { literal: "oklch(0.5 0.1 200)" })
    expect(isAppearanceDirty(a, a)).toBe(false)
    expect(isAppearanceDirty(b, a)).toBe(true)
  })

  it("round-trips localStorage payload", () => {
    const draft = parseAppearance({
      palette: { paper: "oklch(0.96 0.012 85)" },
    })
    const raw = serializeMagicPersist({
      v: 2,
      open: true,
      themeId: "paper",
      drafts: { paper: draft },
    })
    const parsed = parseMagicPersist(raw)
    expect(parsed?.open).toBe(true)
    expect(parsed?.themeId).toBe("paper")
    expect(parsed?.drafts.paper?.palette.paper).toBe(draft.palette.paper)
  })
})

describe("appearance-store setToken + persist", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
    vi.stubGlobal("localStorage", storage)
    useAppearanceStore.setState({
      open: false,
      pickArmed: false,
      themeId: "paper",
      draft: null,
      preview: null,
      saved: null,
      drafts: {},
      savedById: {},
      selected: null,
      pickPoint: null,
      hydrated: false,
    })
    resetMagicPersistRuntime()
    storage.clear()
  })

  afterEach(() => {
    resetMagicPersistRuntime()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("patches a single token on draft without waiting for LS", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({
      draft: base,
      saved: base,
      themeId: "paper",
      savedById: { paper: base },
      open: true,
    })
    useAppearanceStore.getState().setToken("--sidebar", {
      literal: "oklch(0.2 0.05 100)",
    })
    const draft = useAppearanceStore.getState().draft!
    expect(draft.tokens["--sidebar"]).toEqual({
      literal: "oklch(0.2 0.05 100)",
    })
    expect(isAppearanceDirty(draft, base)).toBe(true)
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeNull()
  })

  it("keeps drag previews out of the draft and persistence until committed", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({
      draft: base,
      saved: base,
      themeId: "paper",
      savedById: { paper: base },
      open: true,
    })

    const store = useAppearanceStore.getState()
    store.previewToken("--sidebar", { literal: "oklch(0.2 0.05 100)" })

    expect(useAppearanceStore.getState().draft).toBe(base)
    const preview = useAppearanceStore.getState().preview
    expect(preview?.kind).toBe("document")
    expect(preview?.document.tokens["--sidebar"]).toEqual({
      literal: "oklch(0.2 0.05 100)",
    })
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeNull()

    store.commitPreview()

    expect(useAppearanceStore.getState().preview).toBeNull()
    expect(useAppearanceStore.getState().draft?.tokens["--sidebar"]).toEqual({
      literal: "oklch(0.2 0.05 100)",
    })
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeNull()
  })

  it("discards a preview without changing the canonical draft", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({
      draft: base,
      saved: base,
      themeId: "paper",
      savedById: { paper: base },
      open: true,
    })

    const store = useAppearanceStore.getState()
    store.previewPaletteRole("accent", "oklch(0.4 0.1 40)")
    store.discardPreview()

    expect(useAppearanceStore.getState().preview).toBeNull()
    expect(useAppearanceStore.getState().draft).toBe(base)
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeNull()
  })

  it("can preview and commit a palette role back to its original value", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({
      draft: base,
      saved: base,
      themeId: "paper",
      savedById: { paper: base },
      open: true,
    })

    const store = useAppearanceStore.getState()
    store.previewPaletteRole("accent", "oklch(0.4 0.1 40)")
    store.previewPaletteRole("accent", base.palette.accent)
    store.commitPreview()

    expect(useAppearanceStore.getState().draft).toBe(base)
    expect(useAppearanceStore.getState().preview).toBeNull()
    expect(isAppearanceDirty(useAppearanceStore.getState().draft, base)).toBe(
      false
    )
  })

  it("coalesces rapid setToken into one localStorage write", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({
      draft: base,
      saved: base,
      themeId: "paper",
      savedById: { paper: base },
      open: true,
    })
    const store = useAppearanceStore.getState()
    store.setToken("--sidebar", { literal: "oklch(0.1 0 0)" })
    store.setToken("--sidebar", { literal: "oklch(0.2 0 0)" })
    store.setToken("--sidebar", { literal: "oklch(0.3 0 0)" })
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeNull()

    vi.advanceTimersByTime(MAGIC_PERSIST_DEBOUNCE_MS)
    const raw = localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)
    expect(raw).toBeTruthy()
    const parsed = parseMagicPersist(raw)
    expect(parsed?.drafts.paper?.tokens["--sidebar"]).toEqual({
      literal: "oklch(0.3 0 0)",
    })
    expect(parsed?.open).toBe(true)
  })

  it("flushMagicPersist writes immediately and cancels debounce", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({
      draft: base,
      saved: base,
      themeId: "paper",
      savedById: { paper: base },
      open: true,
    })
    const store = useAppearanceStore.getState()
    store.previewPaletteRole("accent", "oklch(0.4 0.1 40)")
    expect(useAppearanceStore.getState().preview).toMatchObject({
      kind: "variable",
      name: "--palette-accent",
      value: "oklch(0.4 0.1 40)",
    })
    store.commitPreview()
    flushMagicPersist()
    const raw = localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)
    expect(parseMagicPersist(raw)?.drafts.paper?.palette.accent).toBe(
      "oklch(0.4 0.1 40)"
    )
    expect(parseMagicPersist(raw)?.preview?.themeId).toBe("paper")
    expect(parseMagicPersist(raw)?.preview?.vars["--palette-accent"]).toBe(
      "oklch(0.4 0.1 40)"
    )
    vi.advanceTimersByTime(MAGIC_PERSIST_DEBOUNCE_MS * 2)
    expect(
      parseMagicPersist(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY))?.drafts
        .paper?.palette.accent
    ).toBe("oklch(0.4 0.1 40)")
  })

  it("removes LS when closed and clean", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({
      draft: base,
      saved: base,
      themeId: "paper",
      savedById: { paper: base },
      open: true,
    })
    flushMagicPersist()
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeTruthy()

    useAppearanceStore.getState().closeMagic()
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeNull()
  })

  it("keeps LS when closed but dirty", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({
      draft: base,
      saved: base,
      themeId: "paper",
      savedById: { paper: base },
      open: true,
    })
    useAppearanceStore.getState().setToken("--sidebar", {
      literal: "oklch(0.2 0 0)",
    })
    flushMagicPersist()
    useAppearanceStore.getState().closeMagic()
    const parsed = parseMagicPersist(
      localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)
    )
    expect(parsed?.open).toBe(false)
    expect(parsed?.drafts.paper?.tokens["--sidebar"]).toEqual({
      literal: "oklch(0.2 0 0)",
    })
  })

  it("hydrateTheme keeps dirty local draft for that theme id", () => {
    const server = defaultAppearance()
    const dirty = patchToken(server, "--sidebar", {
      literal: "oklch(0.11 0 0)",
    })
    localStorage.setItem(
      APPEARANCE_MAGIC_LS_KEY,
      serializeMagicPersist({
        v: 2,
        open: true,
        themeId: "paper",
        drafts: { paper: dirty },
      })
    )
    useAppearanceStore.getState().hydrateTheme("paper", server)
    const { draft, saved, open } = useAppearanceStore.getState()
    expect(open).toBe(true)
    expect(useAppearanceStore.getState().pickArmed).toBe(true)
    expect(saved?.tokens["--sidebar"]).toBeUndefined()
    expect(draft?.tokens["--sidebar"]).toEqual({ literal: "oklch(0.11 0 0)" })
  })

  it("restores the open magic document instead of the active slot", () => {
    const paper = defaultAppearance()
    const ink = parseAppearance({ scheme: "dark" })
    const dirtyInk = patchToken(ink, "--composer", {
      literal: "oklch(0.3 0.05 20)",
    })
    localStorage.setItem(
      APPEARANCE_MAGIC_LS_KEY,
      serializeMagicPersist({
        v: 2,
        open: true,
        themeId: "ink",
        drafts: { ink: dirtyInk },
      })
    )
    useAppearanceStore.getState().hydrateThemeLibrary(
      [
        { id: "paper", document: paper },
        { id: "ink", document: ink },
      ],
      "paper"
    )
    expect(useAppearanceStore.getState().themeId).toBe("ink")
    expect(useAppearanceStore.getState().draft?.tokens["--composer"]).toEqual(
      dirtyInk.tokens["--composer"]
    )
    expect(useAppearanceStore.getState().pickArmed).toBe(true)
  })

  it("keeps the hydrated document when the active slot changes", () => {
    const paper = defaultAppearance()
    const ink = parseAppearance({ scheme: "dark" })
    useAppearanceStore.getState().hydrateThemeLibrary(
      [
        { id: "paper", document: paper },
        { id: "ink", document: ink },
      ],
      "paper"
    )
    useAppearanceStore.getState().hydrateTheme("ink", ink)
    useAppearanceStore.getState().hydrateThemeLibrary(
      [
        { id: "paper", document: paper },
        { id: "ink", document: ink },
      ],
      "paper"
    )
    expect(useAppearanceStore.getState().themeId).toBe("ink")
  })

  it("switching themes restores a dirty draft for the other id", () => {
    const paper = defaultAppearance()
    const ink = parseAppearance({ scheme: "dark" })
    useAppearanceStore.getState().hydrateTheme("paper", paper)
    useAppearanceStore.getState().setToken("--composer", {
      literal: "oklch(0.5 0.1 20)",
    })
    flushMagicPersist()
    useAppearanceStore.getState().hydrateTheme("ink", ink)
    expect(useAppearanceStore.getState().themeId).toBe("ink")
    expect(useAppearanceStore.getState().draft?.scheme).toBe("dark")
    useAppearanceStore.getState().hydrateTheme("paper", paper)
    expect(useAppearanceStore.getState().draft?.tokens["--composer"]).toEqual({
      literal: "oklch(0.5 0.1 20)",
    })
  })

  it("hydrating a library theme then setDraft dirties that document", () => {
    const paper = defaultAppearance()
    const ink = parseAppearance({ scheme: "dark" })
    useAppearanceStore.getState().hydrateTheme("paper", paper)
    useAppearanceStore.getState().hydrateTheme("ink", ink)
    useAppearanceStore.getState().setDraft(
      parseAppearance({
        scheme: "dark",
        palette: { accent: "oklch(0.4 0.15 40)" },
      })
    )
    const { themeId, draft, saved } = useAppearanceStore.getState()
    expect(themeId).toBe("ink")
    expect(draft?.palette.accent).toBe("oklch(0.4 0.15 40)")
    expect(isAppearanceDirty(draft, saved)).toBe(true)
    expect(isAppearanceDirty(draft, ink)).toBe(true)
  })
})
