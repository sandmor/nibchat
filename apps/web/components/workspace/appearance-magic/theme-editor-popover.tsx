"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { OklchPicker } from "@/components/ui/oklch-picker"
import { cn } from "@/lib/utils"
import {
  addPaletteExtra,
  compileAppearance,
  newPaletteExtraId,
  type Appearance,
} from "@/lib/appearance"
import {
  formatOklch,
  paletteRefOf,
  resolveColorValue,
} from "@/lib/appearance-color"
import {
  PALETTE_ROLE_LABELS,
  PALETTE_ROLES,
  groupById,
  tokensInGroup,
  tokenById,
  type ColorValue,
  type ThemeGroupId,
} from "@/lib/appearance-registry"
import { MAGIC_RECENT_LS_KEY, userScopedStorageKey } from "@/lib/theme-slot"
import { useAppearanceStore, type ThemeSelection } from "@/lib/appearance-store"
import { useAppearanceColorPreview } from "@/hooks/use-appearance-color-preview"

function paletteLinkLabel(doc: Appearance, ref: string): string {
  if (ref.startsWith("extra:")) {
    const id = ref.slice(6)
    return doc.palette.extras.find((item) => item.id === id)?.name ?? id
  }
  return PALETTE_ROLE_LABELS[ref as keyof typeof PALETTE_ROLE_LABELS] ?? ref
}

function useCompactPickerLayout() {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    function update() {
      setCompact(
        window.innerWidth < 640 ||
          window.matchMedia("(pointer: coarse)").matches
      )
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return compact
}

function useViewportMetrics() {
  const [metrics, setMetrics] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 400,
    h: typeof window !== "undefined" ? window.innerHeight : 600,
    scrollbar: 0,
  }))
  useEffect(() => {
    function measure() {
      setMetrics({
        w: window.innerWidth,
        h: window.innerHeight,
        scrollbar: Math.max(
          0,
          window.innerWidth - document.documentElement.clientWidth
        ),
      })
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])
  return metrics
}

function readRecent(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(
      userScopedStorageKey(
        MAGIC_RECENT_LS_KEY,
        document.documentElement.dataset.nibchatUserId || undefined
      )
    )
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
}

function pushRecent(css: string) {
  if (typeof window === "undefined") return
  const next = [css, ...readRecent().filter((item) => item !== css)].slice(0, 8)
  try {
    localStorage.setItem(
      userScopedStorageKey(
        MAGIC_RECENT_LS_KEY,
        document.documentElement.dataset.nibchatUserId || undefined
      ),
      JSON.stringify(next)
    )
  } catch {
    /* ignore */
  }
}

function RecentColors({ onSelect }: { onSelect: (value: ColorValue) => void }) {
  const [recent] = useState(readRecent)
  if (recent.length === 0) return null
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
        Recent
      </p>
      <div className="flex flex-wrap gap-1.5">
        {recent.map((css) => (
          <button
            key={css}
            type="button"
            onClick={() => onSelect({ literal: css })}
            className="size-6 rounded-md ring-1 ring-border"
            style={{ background: css }}
            aria-label={css}
          />
        ))}
      </div>
    </div>
  )
}

function currentColorValue(
  doc: Appearance,
  selection: ThemeSelection
): ColorValue {
  if (selection.kind === "group") {
    const group = groupById(selection.groupId)
    const fillToken = group ? tokenById(group.fillTokenId) : null
    return (
      doc.groups[selection.groupId]?.fill ??
      fillToken?.recipe ?? { ref: "paper" }
    )
  }
  const token = tokenById(selection.surfaceId)
  if (!token) return { ref: "paper" }
  return doc.tokens[token.cssVar] ?? token.recipe
}

export function ThemeEditorPopover() {
  const selected = useAppearanceStore((s) => s.selected)
  const pickPoint = useAppearanceStore((s) => s.pickPoint)
  const draft = useAppearanceStore((s) => s.draft)
  const setDraft = useAppearanceStore((s) => s.setDraft)
  const previewGroupFill = useAppearanceStore((s) => s.previewGroupFill)
  const previewToken = useAppearanceStore((s) => s.previewToken)
  const commitPreview = useAppearanceStore((s) => s.commitPreview)
  const discardPreview = useAppearanceStore((s) => s.discardPreview)
  const setGroupFill = useAppearanceStore((s) => s.setGroupFill)
  const setToken = useAppearanceStore((s) => s.setToken)
  const selectTarget = useAppearanceStore((s) => s.selectTarget)
  const isNarrow = useCompactPickerLayout()
  const viewport = useViewportMetrics()
  const [extraName, setExtraName] = useState("")
  const [namingExtra, setNamingExtra] = useState(false)

  const group =
    selected?.kind === "group"
      ? groupById(selected.groupId)
      : selected
        ? groupById(tokenById(selected.surfaceId)?.groupId ?? "")
        : null
  const surface =
    selected?.kind === "surface" ? tokenById(selected.surfaceId) : null
  const members = group ? tokensInGroup(group.id) : []

  const stored = draft && selected ? currentColorValue(draft, selected) : null
  const resolvedCss =
    draft && stored ? resolveColorValue(draft, stored) : "oklch(0.5 0 0)"
  const linkedRef = stored ? paletteRefOf(stored) : null

  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const picker = useAppearanceColorPreview({
    source: resolvedCss,
    publish(literal) {
      if (!selected || !draft) return
      const value = { literal }
      if (selected.kind === "group") {
        previewGroupFill(
          selected.groupId,
          value,
          draft.groups[selected.groupId]?.recolorText
        )
      } else if (surface) {
        previewToken(surface.cssVar, value)
      }
    },
    commit: commitPreview,
    discard: discardPreview,
  })

  useEffect(() => {
    const open = Boolean(selected && draft)
    if (open && !wasOpenRef.current) {
      const active = document.activeElement
      restoreFocusRef.current = active instanceof HTMLElement ? active : null
      requestAnimationFrame(() => dialogRef.current?.focus())
    }
    if (!open && wasOpenRef.current) {
      const restore = restoreFocusRef.current
      restoreFocusRef.current = null
      if (restore?.isConnected) restore.focus()
    }
    wasOpenRef.current = open
  }, [selected, draft])

  useEffect(() => {
    if (!selected || !draft) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        selectTarget(null)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [selected, draft, selectTarget])

  if (!selected || !draft || !group) return null

  function applyValue(value: ColorValue) {
    if (selected!.kind === "group") {
      setGroupFill(
        selected!.groupId,
        value,
        draft!.groups[selected!.groupId]?.recolorText
      )
    } else if (surface) {
      setToken(surface.cssVar, value)
    }
  }

  function linkPalette(ref: string) {
    applyValue({ ref })
  }

  function reset() {
    if (selected!.kind === "group") {
      setGroupFill(selected!.groupId, undefined, false)
    } else if (surface) {
      setToken(surface.cssVar, undefined)
    }
  }

  function addExtra() {
    const name = extraName.trim()
    if (!name || !draft) return
    const id = newPaletteExtraId(draft, name)
    setDraft(
      addPaletteExtra(draft, { id, name, value: formatOklch(picker.color) })
    )
    setExtraName("")
    setNamingExtra(false)
  }

  const recolorText = Boolean(draft.groups[group.id]?.recolorText)
  const EDGE = 16
  const PANEL_W = 320
  const PANEL_H = 560
  const { w: viewW, h: viewH, scrollbar } = viewport

  const panelStyle: CSSProperties | undefined = isNarrow
    ? {
        bottom: `max(${EDGE}px, calc(env(safe-area-inset-bottom, 0px) + ${EDGE}px))`,
        left: EDGE,
        right: EDGE + scrollbar,
        maxHeight: "min(34rem, calc(100dvh - 2rem))",
      }
    : {
        position: "fixed",
        left: Math.min(
          Math.max(EDGE, (pickPoint?.x ?? 24) + 12),
          Math.max(EDGE, viewW - PANEL_W - EDGE - scrollbar)
        ),
        top: Math.min(
          Math.max(EDGE, (pickPoint?.y ?? 24) + 12),
          Math.max(EDGE, viewH - PANEL_H - EDGE)
        ),
        zIndex: 80,
      }

  const compiled = compileAppearance(draft)

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      data-magic-chrome
      role="dialog"
      aria-modal="false"
      aria-label={`Edit ${surface?.label ?? group.label}`}
      className={cn(
        "z-[80] flex flex-col gap-3 overflow-y-auto border border-popover-border bg-popover p-4 text-popover-foreground shadow-lg outline-none",
        isNarrow ? "fixed rounded-2xl pb-4" : "fixed w-[20rem] rounded-2xl"
      )}
      style={panelStyle}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
            {group.label}
            {surface ? ` / ${surface.label}` : ""}
          </p>
          <Label className="text-sm font-medium">
            {surface?.label ?? `${group.label} fill`}
          </Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {linkedRef
              ? `Linked to ${paletteLinkLabel(draft, linkedRef)}`
              : "Custom color"}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            picker.commit()
            pushRecent(formatOklch(picker.color))
            selectTarget(null)
          }}
        >
          Done
        </Button>
      </div>

      <div className="flex rounded-lg bg-muted p-0.5 text-xs">
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-2 py-1",
            selected.kind === "group" && "bg-popover shadow-sm"
          )}
          onClick={() =>
            selectTarget({ kind: "group", groupId: group.id }, pickPoint)
          }
        >
          Whole group
        </button>
        <button
          type="button"
          className={cn(
            "flex-1 rounded-md px-2 py-1",
            selected.kind === "surface" && "bg-popover shadow-sm"
          )}
          disabled={!surface && members.length === 0}
          onClick={() => {
            const id = surface?.id ?? group.fillTokenId
            selectTarget({ kind: "surface", surfaceId: id }, pickPoint)
          }}
        >
          This surface
        </button>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
          Palette
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              title={PALETTE_ROLE_LABELS[role]}
              aria-label={PALETTE_ROLE_LABELS[role]}
              onClick={() => linkPalette(role)}
              className={cn(
                "size-7 rounded-md ring-1 ring-border",
                linkedRef === role && "ring-2 ring-ring"
              )}
              style={{ background: compiled[`--palette-${role}`] }}
            />
          ))}
          {draft.palette.extras.map((extra) => (
            <button
              key={extra.id}
              type="button"
              title={extra.name ?? extra.id}
              onClick={() => linkPalette(`extra:${extra.id}`)}
              className={cn(
                "size-7 rounded-md ring-1 ring-border",
                linkedRef === `extra:${extra.id}` && "ring-2 ring-ring"
              )}
              style={{ background: extra.value }}
            />
          ))}
          <button
            type="button"
            onClick={() => setNamingExtra((open) => !open)}
            className="ring-dashed size-7 rounded-md text-xs text-muted-foreground ring-1 ring-border"
            title="Add current color to palette"
            aria-label="Add current color to palette"
            aria-expanded={namingExtra}
          >
            +
          </button>
        </div>
        {namingExtra ? (
          <form
            className="mt-2 flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              addExtra()
            }}
          >
            <Input
              value={extraName}
              onChange={(event) => setExtraName(event.target.value)}
              placeholder="Name"
              aria-label="New palette color name"
              className="h-7 text-xs"
              autoFocus
            />
            <Button
              type="submit"
              size="xs"
              variant="outline"
              disabled={!extraName.trim()}
            >
              Add
            </Button>
          </form>
        ) : null}
      </div>

      <RecentColors
        key={`${selected.kind}:${selected.kind === "group" ? selected.groupId : selected.surfaceId}`}
        onSelect={applyValue}
      />

      <OklchPicker
        value={picker.color}
        onChange={picker.change}
        onChangeEnd={picker.commit}
        compact={isNarrow}
      />

      {selected.kind === "group" && (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Also recolor text</span>
          <Switch
            checked={recolorText}
            onCheckedChange={(checked) =>
              setGroupFill(
                group.id as ThemeGroupId,
                draft.groups[group.id]?.fill,
                checked
              )
            }
          />
        </label>
      )}

      {selected.kind === "group" && members.length > 1 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            Surfaces in this group
          </p>
          <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
            {members.map((token) => (
              <button
                key={token.id}
                type="button"
                onClick={() =>
                  selectTarget(
                    { kind: "surface", surfaceId: token.id },
                    pickPoint
                  )
                }
                className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted"
              >
                <span
                  className="size-3.5 rounded-sm ring-1 ring-border"
                  style={{ background: compiled[token.cssVar] }}
                />
                {token.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={reset}>
          Reset to default
        </Button>
      </div>
    </div>
  )
}
