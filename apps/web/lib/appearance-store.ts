"use client"

import { create } from "zustand"
import {
  appearanceToJson,
  parseAppearance,
  type Appearance,
} from "@/lib/appearance"

export const APPEARANCE_MAGIC_LS_KEY = "nibchat.appearance.magic"
const LS_VERSION = 1 as const

/** Idle wait before writing draft/open to localStorage during rapid edits. */
export const MAGIC_PERSIST_DEBOUNCE_MS = 250

export type PickPoint = { x: number; y: number }

export type AppearanceMagicPersist = {
  v: typeof LS_VERSION
  open: boolean
  draft: Appearance
}

type AppearanceStore = {
  open: boolean
  /** When true, surface clicks open the color picker. Off until pencil armed. */
  pickArmed: boolean
  draft: Appearance | null
  saved: Appearance | null
  selectedSurfaceId: string | null
  pickPoint: PickPoint | null
  hydrated: boolean
  openMagic: () => void
  closeMagic: () => void
  togglePickArmed: () => void
  setDraft: (doc: Appearance) => void
  setVar: (cssVar: `--${string}` | string, value: string) => void
  selectSurface: (id: string | null, point?: PickPoint | null) => void
  markSaved: (doc: Appearance) => void
  hydrateFromServer: (serverDoc: Appearance) => void
  discardToSaved: () => void
  isDirty: () => boolean
}

function sameDoc(a: Appearance, b: Appearance): boolean {
  return appearanceToJson(a, false) === appearanceToJson(b, false)
}

export function isAppearanceDirty(
  draft: Appearance | null,
  saved: Appearance | null
): boolean {
  if (!draft || !saved) return false
  return !sameDoc(draft, saved)
}

/** Canonical document shape (Zod + motion vars merged into vars). */
export function canonicalAppearance(doc: Appearance): Appearance {
  return parseAppearance(doc)
}

export function serializeMagicPersist(payload: AppearanceMagicPersist): string {
  return JSON.stringify({
    v: LS_VERSION,
    open: payload.open,
    draft: payload.draft,
  })
}

export function parseMagicPersist(
  raw: string | null
): AppearanceMagicPersist | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as {
      v?: number
      open?: unknown
      draft?: unknown
    }
    if (data.v !== LS_VERSION || !data.draft || typeof data.draft !== "object") {
      return null
    }
    return {
      v: LS_VERSION,
      open: Boolean(data.open),
      draft: parseAppearance(data.draft),
    }
  } catch {
    return null
  }
}

function readLocalMagic(): AppearanceMagicPersist | null {
  if (typeof window === "undefined") return null
  try {
    return parseMagicPersist(localStorage.getItem(APPEARANCE_MAGIC_LS_KEY))
  } catch {
    return null
  }
}

function removeLocalMagic(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(APPEARANCE_MAGIC_LS_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Synchronous LS sync for open+draft.
 * Clean + closed → remove key. Otherwise write canonical draft.
 */
export function writeLocalMagic(
  open: boolean,
  draft: Appearance | null,
  saved: Appearance | null = null
): void {
  if (typeof window === "undefined" || !draft) return
  const canonical = canonicalAppearance(draft)
  if (!open && !isAppearanceDirty(canonical, saved)) {
    removeLocalMagic()
    return
  }
  try {
    localStorage.setItem(
      APPEARANCE_MAGIC_LS_KEY,
      serializeMagicPersist({ v: LS_VERSION, open, draft: canonical })
    )
  } catch {
    /* ignore quota / private mode */
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let unloadBound = false

/**
 * Write LS from store; coalesce in-store draft to canonical when it would
 * change structural identity (motion-var merge, etc.).
 */
function writeFromStore(): void {
  const { open, draft, saved } = useAppearanceStore.getState()
  if (!draft) return
  const canonical = canonicalAppearance(draft)
  if (!sameDoc(draft, canonical)) {
    useAppearanceStore.setState({ draft: canonical })
  }
  writeLocalMagic(open, canonical, saved)
}

/** Cancel a pending debounce and write the latest draft now. */
export function flushMagicPersist(): void {
  if (persistTimer != null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeFromStore()
}

/**
 * Coalesce rapid draft mutations (color drag, JSON typing) into one LS write.
 * Survivability for full-page exit is handled by flushMagicPersist + unload.
 */
export function scheduleMagicPersist(): void {
  if (typeof window === "undefined") return
  ensureUnloadFlush()
  if (persistTimer != null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    writeFromStore()
  }, MAGIC_PERSIST_DEBOUNCE_MS)
}

function ensureUnloadFlush(): void {
  if (typeof window === "undefined" || unloadBound) return
  unloadBound = true
  const onLeave = () => flushMagicPersist()
  window.addEventListener("pagehide", onLeave)
  window.addEventListener("beforeunload", onLeave)
}

/** Test helper: clear debounce timer (does not remove window unload listeners). */
export function resetMagicPersistRuntime(): void {
  if (persistTimer != null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
}

/**
 * Pure hydrate reconcile: prefer local dirty draft over server document,
 * still restore magic open flag from localStorage.
 */
export function reconcileHydrate(
  serverDoc: Appearance,
  local: AppearanceMagicPersist | null
): { draft: Appearance; saved: Appearance; open: boolean } {
  const saved = parseAppearance(serverDoc)
  if (local && !sameDoc(local.draft, saved)) {
    return {
      draft: parseAppearance(local.draft),
      saved,
      open: local.open,
    }
  }
  return {
    draft: saved,
    saved,
    open: local?.open ?? false,
  }
}

/**
 * Later server prop updates (not first paint): always refresh `saved`;
 * take server into `draft` only when the session was clean vs previous saved.
 */
export function reconcileServerUpdate(
  serverDoc: Appearance,
  draft: Appearance | null,
  previousSaved: Appearance | null
): { draft: Appearance; saved: Appearance } {
  const saved = parseAppearance(serverDoc)
  if (!draft || !previousSaved || !isAppearanceDirty(draft, previousSaved)) {
    return { draft: saved, saved }
  }
  return { draft, saved }
}

export const useAppearanceStore = create<AppearanceStore>((set, get) => ({
  open: false,
  pickArmed: false,
  draft: null,
  saved: null,
  selectedSurfaceId: null,
  pickPoint: null,
  hydrated: false,

  openMagic: () => {
    // Entering magic does not arm pick — user must tap the pencil orb.
    set({
      open: true,
      pickArmed: false,
      selectedSurfaceId: null,
      pickPoint: null,
    })
    flushMagicPersist()
  },

  closeMagic: () => {
    set({
      open: false,
      pickArmed: false,
      selectedSurfaceId: null,
      pickPoint: null,
    })
    flushMagicPersist()
  },

  togglePickArmed: () => {
    const next = !get().pickArmed
    set({
      pickArmed: next,
      ...(next ? {} : { selectedSurfaceId: null, pickPoint: null }),
    })
  },

  setDraft: (doc) => {
    // Full-document path (JSON editor / presets) — normalize once.
    set({ draft: parseAppearance(doc) })
    scheduleMagicPersist()
  },

  setVar: (cssVar, value) => {
    const { draft } = get()
    if (!draft) return
    // Hot path: patch one token only — no Zod re-parse (live preview + apply).
    set({
      draft: {
        ...draft,
        vars: { ...draft.vars, [cssVar]: value },
      },
    })
    scheduleMagicPersist()
  },

  selectSurface: (id, point = null) => {
    set({
      selectedSurfaceId: id,
      pickPoint: id ? (point ?? null) : null,
    })
  },

  markSaved: (doc) => {
    const next = parseAppearance(doc)
    set({
      draft: next,
      saved: next,
      selectedSurfaceId: null,
      pickPoint: null,
    })
    flushMagicPersist()
  },

  hydrateFromServer: (serverDoc) => {
    if (!get().hydrated) {
      const local = readLocalMagic()
      const { draft, saved, open } = reconcileHydrate(serverDoc, local)
      set({ draft, saved, open, hydrated: true })
      writeLocalMagic(open, draft, saved)
      return
    }
    // Subsequent server props: refresh saved; adopt into draft only if clean.
    const { draft, saved: previousSaved, open } = get()
    const next = reconcileServerUpdate(serverDoc, draft, previousSaved)
    set({ draft: next.draft, saved: next.saved })
    writeLocalMagic(open, next.draft, next.saved)
  },

  discardToSaved: () => {
    const { saved } = get()
    if (!saved) return
    set({
      draft: parseAppearance(saved),
      selectedSurfaceId: null,
      pickPoint: null,
    })
    flushMagicPersist()
  },

  isDirty: () => {
    const { draft, saved } = get()
    return isAppearanceDirty(draft, saved)
  },
}))
