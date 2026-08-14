"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/lib/trpc-react"
import { compileAppearance, type ThemeRecord } from "@/lib/appearance"
import { PALETTE_ROLES } from "@/lib/appearance-registry"
import { isAppearanceDirty, useAppearanceStore } from "@/lib/appearance-store"
import { useWorkspaceChrome } from "../shell"
import { ThemeDocumentEditor } from "./theme-document-editor"

const EMPTY_THEMES: ThemeRecord[] = []

export function AppearanceSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { activeThemeId, lightThemeId, darkThemeId } = useWorkspaceChrome()
  const storeDraft = useAppearanceStore((s) => s.draft)
  const storeSaved = useAppearanceStore((s) => s.saved)
  const storeThemeId = useAppearanceStore((s) => s.themeId)
  const storeDrafts = useAppearanceStore((s) => s.drafts)
  const hydrateTheme = useAppearanceStore((s) => s.hydrateTheme)

  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const themes = settingsQuery.data?.themes ?? EMPTY_THEMES
  const themeItems = Object.fromEntries(
    themes.map((theme) => [theme.id, theme.name])
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const previousActiveThemeId = useRef(activeThemeId)

  useEffect(() => {
    if (previousActiveThemeId.current === activeThemeId) return
    previousActiveThemeId.current = activeThemeId
    const state = useAppearanceStore.getState()
    // Slot changes (including D) end a clean library viewing session.
    // Dirty drafts and an open picker keep the document being painted.
    if (state.open || isAppearanceDirty(state.draft, state.saved)) return
    setSelectedId(null)
    const slotTheme = themes.find((theme) => theme.id === activeThemeId)
    if (slotTheme) hydrateTheme(slotTheme.id, slotTheme.document)
  }, [activeThemeId, hydrateTheme, themes])

  const requestedId =
    selectedId ?? storeThemeId ?? activeThemeId ?? themes[0]?.id ?? null
  const selected =
    themes.find((theme) => theme.id === requestedId) ??
    themes.find((theme) => theme.id === activeThemeId) ??
    themes[0] ??
    null
  const effectiveId = selected?.id ?? null

  const editingSelected = storeThemeId === effectiveId
  const effectiveDraft =
    editingSelected && storeDraft ? storeDraft : (selected?.document ?? null)
  const effectiveSaved =
    editingSelected && storeSaved ? storeSaved : (selected?.document ?? null)

  const slotThemeRef = useRef(
    themes.find((theme) => theme.id === activeThemeId) ?? null
  )
  const hydrateThemeRef = useRef(hydrateTheme)

  useEffect(() => {
    slotThemeRef.current =
      themes.find((theme) => theme.id === activeThemeId) ?? null
    hydrateThemeRef.current = hydrateTheme
  }, [activeThemeId, hydrateTheme, themes])

  useEffect(() => {
    if (!selected) return
    if (storeThemeId === selected.id) return
    hydrateTheme(selected.id, selected.document)
  }, [hydrateTheme, selected, storeThemeId])

  useEffect(() => {
    return () => {
      const state = useAppearanceStore.getState()
      if (state.open || isAppearanceDirty(state.draft, state.saved)) return
      const slotTheme = slotThemeRef.current
      if (slotTheme) hydrateThemeRef.current(slotTheme.id, slotTheme.document)
    }
  }, [])

  const refetch = () =>
    queryClient.invalidateQueries(trpc.workspace.getSettings.queryFilter())

  const createMut = useMutation(
    trpc.workspace.createTheme.mutationOptions({
      onSuccess: async (created) => {
        toast.success("Theme created")
        await refetch()
        setSelectedId(created.id)
      },
      onError: (error) => toast.error(error.message || "Could not create"),
    })
  )
  const duplicateMut = useMutation(
    trpc.workspace.duplicateTheme.mutationOptions({
      onSuccess: async (created) => {
        toast.success("Theme duplicated")
        await refetch()
        setSelectedId(created.id)
      },
      onError: (error) => toast.error(error.message || "Could not duplicate"),
    })
  )
  const deleteMut = useMutation(
    trpc.workspace.deleteTheme.mutationOptions({
      onSuccess: async () => {
        toast.success("Theme deleted")
        setSelectedId(null)
        setDeleteId(null)
        await refetch()
      },
      onError: (error) => toast.error(error.message || "Could not delete"),
    })
  )
  const slotsMut = useMutation(
    trpc.workspace.setThemeSlots.mutationOptions({
      onSuccess: async () => {
        toast.success("In-use themes updated")
        await refetch()
      },
      onError: (error) => toast.error(error.message || "Could not assign"),
    })
  )

  const deleteTarget = themes.find((theme) => theme.id === deleteId) ?? null
  const deleteBlocked =
    deleteTarget != null &&
    (deleteTarget.id === lightThemeId || deleteTarget.id === darkThemeId)

  function themeIsDirty(theme: ThemeRecord) {
    if (storeThemeId === theme.id) {
      return isAppearanceDirty(storeDraft, storeSaved)
    }
    const draft = storeDrafts[theme.id]
    return draft ? isAppearanceDirty(draft, theme.document) : false
  }

  function documentForCard(theme: ThemeRecord) {
    if (theme.id === storeThemeId && storeDraft) return storeDraft
    return storeDrafts[theme.id] ?? theme.document
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Select. Preview. Save.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-medium">In use</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SlotSelect
              label="Light"
              value={lightThemeId}
              items={themeItems}
              themes={themes}
              disabled={slotsMut.isPending}
              onChange={(id) =>
                slotsMut.mutate({ lightThemeId: id, darkThemeId })
              }
            />
            <SlotSelect
              label="Dark"
              value={darkThemeId}
              items={themeItems}
              themes={themes}
              disabled={slotsMut.isPending}
              onChange={(id) =>
                slotsMut.mutate({ lightThemeId, darkThemeId: id })
              }
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Library</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                Named documents. Click one to view and paint it.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => createMut.mutate({ name: "Untitled theme" })}
            >
              New theme
            </Button>
          </div>

          <ul className="grid gap-2 sm:grid-cols-2">
            {themes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                appearance={documentForCard(theme)}
                selected={theme.id === effectiveId}
                light={theme.id === lightThemeId}
                dark={theme.id === darkThemeId}
                unsaved={themeIsDirty(theme)}
                onSelect={() => {
                  setSelectedId(theme.id)
                  hydrateTheme(theme.id, theme.document)
                }}
                onDuplicate={() => duplicateMut.mutate({ id: theme.id })}
                onDelete={() => setDeleteId(theme.id)}
              />
            ))}
          </ul>
        </section>

        {selected && effectiveDraft && effectiveSaved && (
          <ThemeDocumentEditor
            key={selected.id}
            theme={selected}
            draft={effectiveDraft}
            saved={effectiveSaved}
          />
        )}
      </CardContent>

      <AlertDialog
        open={deleteId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteBlocked ? "Theme is in use" : "Delete theme?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlocked
                ? "Assign another theme to Light or Dark before deleting this one."
                : `Delete “${deleteTarget?.name ?? "this theme"}”? This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!deleteBlocked && (
              <AlertDialogAction
                variant="destructive"
                disabled={deleteMut.isPending}
                onClick={() => {
                  if (deleteId) deleteMut.mutate({ id: deleteId })
                }}
              >
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function SlotSelect({
  label,
  value,
  items,
  themes,
  disabled,
  onChange,
}: {
  label: string
  value: string
  items: Record<string, string>
  themes: ThemeRecord[]
  disabled: boolean
  onChange: (id: string) => void
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select
        value={value}
        items={items}
        disabled={disabled}
        onValueChange={(id) => {
          if (typeof id === "string" && id !== value) onChange(id)
        }}
      >
        <SelectTrigger className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {themes.map((theme) => (
            <SelectItem key={theme.id} value={theme.id}>
              {theme.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function ThemeCard({
  theme,
  appearance,
  selected,
  light,
  dark,
  unsaved,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  theme: ThemeRecord
  appearance: ThemeRecord["document"]
  selected: boolean
  light: boolean
  dark: boolean
  unsaved: boolean
  onSelect: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const compiled = compileAppearance(appearance)
  return (
    <li className="space-y-1">
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "w-full rounded-xl border p-3 text-left",
          selected ? "border-ring ring-2 ring-ring/30" : "border-border"
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="block text-sm font-medium">{theme.name}</span>
          <span className="flex flex-wrap justify-end gap-1">
            {light ? <Badge variant="outline">Light</Badge> : null}
            {dark ? <Badge variant="outline">Dark</Badge> : null}
            {unsaved ? <Badge variant="secondary">Unsaved</Badge> : null}
          </span>
        </span>
        <span className="mt-2 flex gap-1">
          {PALETTE_ROLES.map((role) => (
            <span
              key={role}
              className="size-4 rounded-full ring-1 ring-border"
              style={{ background: compiled[`--palette-${role}`] }}
            />
          ))}
        </span>
      </button>
      {selected ? (
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : null}
    </li>
  )
}
