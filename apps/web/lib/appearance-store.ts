"use client"

import { create } from "zustand"
import {
  appearanceToJson,
  compileAppearance,
  parseAppearance,
  patchGroupFill,
  patchPalette,
  patchPaletteExtra,
  patchToken,
  type Appearance,
} from "@/lib/appearance"
import {
  extraPaletteVar,
  type ColorValue,
  type PaletteRole,
  type ThemeGroupId,
} from "@/lib/appearance-registry"
import type { ThemeHit } from "@/lib/appearance-targets"

type ThemeDocument = { id: string; document: Appearance }

export const APPEARANCE_MAGIC_LS_KEY = "nibchat.appearance.magic"
const LS_VERSION = 2 as const

export const MAGIC_PERSIST_DEBOUNCE_MS = 250

export type PickPoint = { x: number; y: number }

export type ThemeSelection =
  | { kind: "group"; groupId: ThemeGroupId }
  | { kind: "surface"; surfaceId: string }

export type AppearancePreview =
  | { kind: "document"; document: Appearance }
  | {
      kind: "variable"
      document: Appearance
      name: `--${string}`
      value: string
    }

export type AppearanceMagicPersist = {
  v: typeof LS_VERSION
  open: boolean
  themeId: string | null
  drafts: Record<string, Appearance>
  preview?: AppearancePreviewSnapshot
}

export type AppearancePreviewSnapshot = {
  themeId: string
  vars: Record<string, string>
  scheme: "light" | "dark"
  density: Appearance["density"]
  motionEnabled: boolean
  motionReduced: Appearance["motion"]["reducedMotion"]
}

function previewSnapshot(
  themeId: string | null,
  doc: Appearance | undefined
): AppearancePreviewSnapshot | undefined {
  if (!themeId || !doc) return undefined
  return {
    themeId,
    vars: compileAppearance(doc),
    scheme: doc.scheme,
    density: doc.density,
    motionEnabled: doc.motion.enabled,
    motionReduced: doc.motion.reducedMotion,
  }
}

type AppearanceStore = {
  open: boolean
  pickArmed: boolean
  themeId: string | null
  draft: Appearance | null
  /** Drag-time state used for rendering only; it is never persisted. */
  preview: AppearancePreview | null
  saved: Appearance | null
  drafts: Record<string, Appearance>
  savedById: Record<string, Appearance>
  selected: ThemeSelection | null
  pickPoint: PickPoint | null
  hydrated: boolean
  openMagic: () => void
  closeMagic: () => void
  togglePickArmed: () => void
  setDraft: (doc: Appearance) => void
  previewPaletteRole: (role: PaletteRole, value: string) => void
  previewPaletteExtra: (id: string, value: string) => void
  previewGroupFill: (
    groupId: ThemeGroupId,
    fill: ColorValue | undefined,
    recolorText?: boolean
  ) => void
  previewToken: (cssVar: string, value: ColorValue | undefined) => void
  commitPreview: () => void
  discardPreview: () => void
  setGroupFill: (
    groupId: ThemeGroupId,
    fill: ColorValue | undefined,
    recolorText?: boolean
  ) => void
  setToken: (cssVar: string, value: ColorValue | undefined) => void
  selectHit: (hit: ThemeHit | null, point?: PickPoint | null) => void
  selectTarget: (
    selection: ThemeSelection | null,
    point?: PickPoint | null
  ) => void
  markSaved: (themeId: string, doc: Appearance) => void
  hydrateThemeLibrary: (themes: ThemeDocument[], activeThemeId: string) => void
  hydrateTheme: (themeId: string, saved: Appearance) => void
  discardToSaved: () => void
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

export function serializeMagicPersist(payload: AppearanceMagicPersist): string {
  return JSON.stringify({
    v: LS_VERSION,
    open: payload.open,
    themeId: payload.themeId,
    drafts: payload.drafts,
    ...(payload.preview ? { preview: payload.preview } : {}),
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
      themeId?: unknown
      drafts?: unknown
      preview?: unknown
    }
    if (data.v !== LS_VERSION) return null
    const drafts: Record<string, Appearance> = {}
    if (data.drafts && typeof data.drafts === "object") {
      for (const [id, doc] of Object.entries(
        data.drafts as Record<string, unknown>
      )) {
        drafts[id] = parseAppearance(doc)
      }
    }
    const preview = data.preview
    const hasPreview =
      preview &&
      typeof preview === "object" &&
      typeof (preview as AppearancePreviewSnapshot).themeId === "string" &&
      typeof (preview as AppearancePreviewSnapshot).vars === "object" &&
      (preview as AppearancePreviewSnapshot).vars !== null &&
      ((preview as AppearancePreviewSnapshot).scheme === "light" ||
        (preview as AppearancePreviewSnapshot).scheme === "dark") &&
      ((preview as AppearancePreviewSnapshot).density === "comfortable" ||
        (preview as AppearancePreviewSnapshot).density === "compact")
    return {
      v: LS_VERSION,
      open: Boolean(data.open),
      themeId: typeof data.themeId === "string" ? data.themeId : null,
      drafts,
      ...(hasPreview ? { preview: preview as AppearancePreviewSnapshot } : {}),
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

function writeLocalMagic(
  open: boolean,
  themeId: string | null,
  drafts: Record<string, Appearance>,
  savedById: Record<string, Appearance>
): void {
  if (typeof window === "undefined") return
  const dirtyDrafts: Record<string, Appearance> = {}
  for (const [id, draft] of Object.entries(drafts)) {
    const saved = savedById[id]
    if (!saved || isAppearanceDirty(draft, saved)) dirtyDrafts[id] = draft
  }
  if (!open && Object.keys(dirtyDrafts).length === 0) {
    removeLocalMagic()
    return
  }
  try {
    const preview = open
      ? previewSnapshot(themeId, drafts[themeId ?? ""])
      : undefined
    localStorage.setItem(
      APPEARANCE_MAGIC_LS_KEY,
      serializeMagicPersist({
        v: LS_VERSION,
        open,
        themeId,
        drafts: dirtyDrafts,
        preview,
      })
    )
  } catch {
    /* ignore quota / private mode */
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
let unloadBound = false

function writeFromStore(): void {
  const { open, themeId, draft, drafts, savedById } =
    useAppearanceStore.getState()
  const nextDrafts = { ...drafts }
  if (themeId && draft) nextDrafts[themeId] = parseAppearance(draft)
  writeLocalMagic(open, themeId, nextDrafts, savedById)
}

export function flushMagicPersist(): void {
  if (persistTimer != null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeFromStore()
}

function scheduleMagicPersist(): void {
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

export function resetMagicPersistRuntime(): void {
  if (persistTimer != null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
}

function hitToSelection(hit: ThemeHit): ThemeSelection {
  if (hit.kind === "group" || !hit.surface) {
    return { kind: "group", groupId: hit.group.id }
  }
  return { kind: "surface", surfaceId: hit.surface.id }
}

function draftState(
  draft: Appearance,
  themeId: string | null,
  drafts: Record<string, Appearance>
) {
  return {
    draft,
    preview: null,
    drafts: themeId ? { ...drafts, [themeId]: draft } : drafts,
  } satisfies Partial<AppearanceStore>
}

function reconcileDraft(
  themeId: string,
  saved: Appearance,
  drafts: Record<string, Appearance>
): Appearance {
  const candidate = drafts[themeId]
  if (candidate && isAppearanceDirty(candidate, saved)) return candidate
  delete drafts[themeId]
  return saved
}

export const useAppearanceStore = create<AppearanceStore>((set, get) => ({
  open: false,
  pickArmed: false,
  themeId: null,
  draft: null,
  preview: null,
  saved: null,
  drafts: {},
  savedById: {},
  selected: null,
  pickPoint: null,
  hydrated: false,

  openMagic: () => {
    set({
      open: true,
      pickArmed: true,
      selected: null,
      pickPoint: null,
    })
    flushMagicPersist()
  },

  closeMagic: () => {
    set({
      open: false,
      preview: null,
      pickArmed: false,
      selected: null,
      pickPoint: null,
    })
    flushMagicPersist()
  },

  togglePickArmed: () => {
    const next = !get().pickArmed
    set({
      pickArmed: next,
      ...(next ? {} : { selected: null, pickPoint: null }),
    })
  },

  setDraft: (doc) => {
    const { themeId, drafts } = get()
    const parsed = parseAppearance(doc)
    set(draftState(parsed, themeId, drafts))
    scheduleMagicPersist()
  },

  previewPaletteRole: (role, value) => {
    const { draft } = get()
    if (!draft) return
    const document =
      draft.palette[role] === value ? draft : patchPalette(draft, role, value)
    set({
      preview: {
        kind: "variable",
        document,
        name: `--palette-${role}`,
        value,
      },
    })
  },

  previewPaletteExtra: (id, value) => {
    const { draft } = get()
    if (!draft) return
    const extra = draft.palette.extras.find((item) => item.id === id)
    const document =
      extra?.value === value ? draft : patchPaletteExtra(draft, id, { value })
    set({
      preview: {
        kind: "variable",
        document,
        name: extraPaletteVar(id),
        value,
      },
    })
  },

  previewGroupFill: (groupId, fill, recolorText) => {
    const { draft } = get()
    if (!draft) return
    set({
      preview: {
        kind: "document",
        document: patchGroupFill(draft, groupId, fill, recolorText),
      },
    })
  },

  previewToken: (cssVar, value) => {
    const { draft } = get()
    if (!draft) return
    set({
      preview: {
        kind: "document",
        document: patchToken(draft, cssVar, value),
      },
    })
  },

  commitPreview: () => {
    const { preview, themeId, drafts } = get()
    if (!preview) return
    const next = preview.document
    set(draftState(next, themeId, drafts))
    scheduleMagicPersist()
  },

  discardPreview: () => set({ preview: null }),

  setGroupFill: (groupId, fill, recolorText) => {
    const { draft, themeId, drafts } = get()
    if (!draft) return
    const next = patchGroupFill(draft, groupId, fill, recolorText)
    set(draftState(next, themeId, drafts))
    scheduleMagicPersist()
  },

  setToken: (cssVar, value) => {
    const { draft, themeId, drafts } = get()
    if (!draft) return
    const next = patchToken(draft, cssVar, value)
    set(draftState(next, themeId, drafts))
    scheduleMagicPersist()
  },

  selectHit: (hit, point = null) => {
    set({
      selected: hit ? hitToSelection(hit) : null,
      pickPoint: hit ? (point ?? null) : null,
    })
  },

  selectTarget: (selection, point = null) => {
    set({
      selected: selection,
      pickPoint: selection ? (point ?? null) : null,
    })
  },

  markSaved: (themeId, doc) => {
    const next = parseAppearance(doc)
    const { drafts, savedById, themeId: currentId } = get()
    const nextDrafts = { ...drafts }
    delete nextDrafts[themeId]
    set({
      drafts: nextDrafts,
      savedById: { ...savedById, [themeId]: next },
      ...(currentId === themeId ? { draft: next, saved: next } : {}),
      preview: null,
    })
    flushMagicPersist()
  },

  hydrateThemeLibrary: (themes, activeThemeId) => {
    const library = new Map(
      themes.map((theme) => [theme.id, parseAppearance(theme.document)])
    )
    const active = library.get(activeThemeId) ?? library.values().next().value
    if (!active) return
    const {
      hydrated,
      drafts: existingDrafts,
      open,
      savedById,
      themeId: currentId,
      pickArmed,
    } = get()
    const local = hydrated ? null : readLocalMagic()
    const drafts: Record<string, Appearance> = {}
    for (const [id, draft] of Object.entries(existingDrafts)) {
      if (library.has(id)) drafts[id] = draft
    }
    if (local) {
      for (const [id, draft] of Object.entries(local.drafts)) {
        if (library.has(id)) drafts[id] = draft
      }
    }
    const preferredId =
      !hydrated && local?.open && local.themeId && library.has(local.themeId)
        ? local.themeId
        : hydrated && currentId && library.has(currentId)
          ? currentId
          : activeThemeId
    const themeId = library.has(preferredId) ? preferredId : activeThemeId
    const saved = library.get(themeId) ?? active
    const draft = reconcileDraft(themeId, saved, drafts)
    const nextSavedById = Object.fromEntries(library) as Record<
      string,
      Appearance
    >
    const restoredOpen = hydrated ? open : (local?.open ?? false)
    set({
      themeId,
      draft,
      preview: null,
      saved,
      drafts,
      savedById: { ...savedById, ...nextSavedById },
      hydrated: true,
      open: restoredOpen,
      pickArmed: hydrated ? pickArmed : restoredOpen,
    })
    writeLocalMagic(restoredOpen, themeId, drafts, {
      ...savedById,
      ...nextSavedById,
    })
  },

  hydrateTheme: (themeId, savedDoc) => {
    const saved = parseAppearance(savedDoc)
    const local = get().hydrated ? null : readLocalMagic()
    const {
      drafts: existingDrafts,
      savedById,
      hydrated,
      open,
      pickArmed,
    } = get()
    const drafts = { ...existingDrafts }
    if (local) {
      for (const [id, doc] of Object.entries(local.drafts)) {
        drafts[id] = doc
      }
    }
    const draft = reconcileDraft(themeId, saved, drafts)
    const restoredOpen = hydrated ? open : (local?.open ?? false)
    set({
      themeId,
      draft,
      preview: null,
      saved,
      drafts,
      savedById: { ...savedById, [themeId]: saved },
      hydrated: true,
      open: restoredOpen,
      pickArmed: hydrated ? pickArmed : restoredOpen,
    })
    writeLocalMagic(restoredOpen, themeId, drafts, {
      ...savedById,
      [themeId]: saved,
    })
  },

  discardToSaved: () => {
    const { saved, themeId, drafts } = get()
    if (!saved) return
    const nextDrafts = { ...drafts }
    if (themeId) delete nextDrafts[themeId]
    set({
      draft: parseAppearance(saved),
      preview: null,
      drafts: nextDrafts,
      selected: null,
      pickPoint: null,
    })
    flushMagicPersist()
  },
}))
