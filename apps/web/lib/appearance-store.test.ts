import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  defaultAppearance,
  appearanceToJson,
  parseAppearance,
  presetDocument,
} from "@/lib/appearance"
import {
  APPEARANCE_MAGIC_LS_KEY,
  MAGIC_PERSIST_DEBOUNCE_MS,
  flushMagicPersist,
  isAppearanceDirty,
  parseMagicPersist,
  reconcileHydrate,
  reconcileServerUpdate,
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
    const b = parseAppearance({
      ...a,
      vars: { ...a.vars, "--sidebar": "oklch(0.5 0.1 200)" },
    })
    expect(isAppearanceDirty(a, a)).toBe(false)
    expect(isAppearanceDirty(b, a)).toBe(true)
    expect(appearanceToJson(a, false)).not.toBe(appearanceToJson(b, false))
  })

  it("round-trips localStorage payload", () => {
    const draft = presetDocument("spatial")
    const raw = serializeMagicPersist({ v: 1, open: true, draft })
    const parsed = parseMagicPersist(raw)
    expect(parsed?.open).toBe(true)
    expect(parsed?.draft.vars["--primary"]).toBe(draft.vars["--primary"])
  })

  it("hydrate keeps dirty local draft over server", () => {
    const server = defaultAppearance()
    const draft = parseAppearance({
      ...server,
      vars: { ...server.vars, "--primary": "oklch(0.4 0.2 30)" },
    })
    const result = reconcileHydrate(server, {
      v: 1,
      open: true,
      draft,
    })
    expect(result.open).toBe(true)
    expect(result.saved.vars["--primary"]).toBe(server.vars["--primary"])
    expect(result.draft.vars["--primary"]).toBe("oklch(0.4 0.2 30)")
  })

  it("hydrate uses server when not dirty", () => {
    const server = defaultAppearance()
    const result = reconcileHydrate(server, {
      v: 1,
      open: true,
      draft: server,
    })
    expect(result.draft).toEqual(result.saved)
    expect(result.open).toBe(true)
  })

  it("server update adopts when clean vs previous saved", () => {
    const previous = defaultAppearance()
    const server = parseAppearance({
      ...previous,
      vars: { ...previous.vars, "--primary": "oklch(0.1 0 0)" },
    })
    const result = reconcileServerUpdate(server, previous, previous)
    expect(result.draft.vars["--primary"]).toBe("oklch(0.1 0 0)")
    expect(result.saved.vars["--primary"]).toBe("oklch(0.1 0 0)")
  })

  it("server update keeps dirty draft and refreshes saved", () => {
    const previousSaved = defaultAppearance()
    const dirty = parseAppearance({
      ...previousSaved,
      vars: { ...previousSaved.vars, "--sidebar": "oklch(0.2 0 0)" },
    })
    const server = parseAppearance({
      ...previousSaved,
      vars: { ...previousSaved.vars, "--primary": "oklch(0.1 0 0)" },
    })
    const result = reconcileServerUpdate(server, dirty, previousSaved)
    expect(result.draft.vars["--sidebar"]).toBe("oklch(0.2 0 0)")
    expect(result.saved.vars["--primary"]).toBe("oklch(0.1 0 0)")
  })
})

describe("appearance-store setVar + persist", () => {
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
      draft: null,
      saved: null,
      selectedSurfaceId: null,
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

  it("patches a single css var on draft without waiting for LS", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({ draft: base, saved: base, open: true })
    useAppearanceStore.getState().setVar("--sidebar", "oklch(0.2 0.05 100)")
    const draft = useAppearanceStore.getState().draft!
    expect(draft.vars["--sidebar"]).toBe("oklch(0.2 0.05 100)")
    expect(draft.vars["--background"]).toBe(base.vars["--background"])
    expect(isAppearanceDirty(draft, base)).toBe(true)
    // Debounced: nothing written yet
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeNull()
  })

  it("coalesces rapid setVar into one localStorage write", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({ draft: base, saved: base, open: true })
    const store = useAppearanceStore.getState()
    store.setVar("--sidebar", "oklch(0.1 0 0)")
    store.setVar("--sidebar", "oklch(0.2 0 0)")
    store.setVar("--sidebar", "oklch(0.3 0 0)")
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeNull()

    vi.advanceTimersByTime(MAGIC_PERSIST_DEBOUNCE_MS)
    const raw = localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)
    expect(raw).toBeTruthy()
    const parsed = parseMagicPersist(raw)
    expect(parsed?.draft.vars["--sidebar"]).toBe("oklch(0.3 0 0)")
    expect(parsed?.open).toBe(true)
  })

  it("flushMagicPersist writes immediately and cancels debounce", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({ draft: base, saved: base, open: true })
    useAppearanceStore.getState().setVar("--primary", "oklch(0.4 0.1 40)")
    flushMagicPersist()
    const raw = localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)
    expect(parseMagicPersist(raw)?.draft.vars["--primary"]).toBe(
      "oklch(0.4 0.1 40)"
    )
    // Later timer must not double-write corrupted state
    vi.advanceTimersByTime(MAGIC_PERSIST_DEBOUNCE_MS * 2)
    expect(
      parseMagicPersist(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY))?.draft
        .vars["--primary"]
    ).toBe("oklch(0.4 0.1 40)")
  })

  it("removes LS when closed and clean", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({ draft: base, saved: base, open: true })
    flushMagicPersist()
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeTruthy()

    useAppearanceStore.getState().closeMagic()
    expect(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY)).toBeNull()
  })

  it("keeps LS when closed but dirty", () => {
    const base = defaultAppearance()
    useAppearanceStore.setState({ draft: base, saved: base, open: true })
    useAppearanceStore.getState().setVar("--sidebar", "oklch(0.2 0 0)")
    flushMagicPersist()
    useAppearanceStore.getState().closeMagic()
    const parsed = parseMagicPersist(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY))
    expect(parsed?.open).toBe(false)
    expect(parsed?.draft.vars["--sidebar"]).toBe("oklch(0.2 0 0)")
  })

  it("hydrateFromServer re-syncs clean session when server props change", () => {
    const serverA = defaultAppearance()
    useAppearanceStore.getState().hydrateFromServer(serverA)
    expect(useAppearanceStore.getState().hydrated).toBe(true)

    const serverB = parseAppearance({
      ...serverA,
      vars: { ...serverA.vars, "--primary": "oklch(0.3 0.1 50)" },
    })
    useAppearanceStore.getState().hydrateFromServer(serverB)
    const { draft, saved, open } = useAppearanceStore.getState()
    expect(draft?.vars["--primary"]).toBe("oklch(0.3 0.1 50)")
    expect(saved?.vars["--primary"]).toBe("oklch(0.3 0.1 50)")
    expect(open).toBe(false)
  })

  it("hydrateFromServer keeps dirty draft on later server update", () => {
    const serverA = defaultAppearance()
    useAppearanceStore.getState().hydrateFromServer(serverA)
    useAppearanceStore.getState().setVar("--sidebar", "oklch(0.11 0 0)")
    flushMagicPersist()

    const serverB = parseAppearance({
      ...serverA,
      vars: { ...serverA.vars, "--primary": "oklch(0.3 0.1 50)" },
    })
    useAppearanceStore.getState().hydrateFromServer(serverB)
    const { draft, saved } = useAppearanceStore.getState()
    expect(draft?.vars["--sidebar"]).toBe("oklch(0.11 0 0)")
    expect(saved?.vars["--primary"]).toBe("oklch(0.3 0.1 50)")
  })
})
