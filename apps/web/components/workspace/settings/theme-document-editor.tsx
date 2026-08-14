"use client"

import { useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { json as jsonLang } from "@codemirror/lang-json"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  addPaletteExtra,
  appearanceToJson,
  newPaletteExtraId,
  parseAppearance,
  removePaletteExtra,
  type Appearance,
  type ThemeRecord,
} from "@/lib/appearance"
import { PALETTE_ROLE_LABELS, PALETTE_ROLES } from "@/lib/appearance-registry"
import { reconcileEditorText } from "@/lib/appearance-editor-sync"
import { isAppearanceDirty, useAppearanceStore } from "@/lib/appearance-store"
import { useTRPC } from "@/lib/trpc-react"
import { PaletteColorField } from "./palette-color-field"

type EditorBuffer = {
  source: Appearance
  text: string
  parseError: string | null
}

const SCHEME_ITEMS = { light: "Light theme", dark: "Dark theme" } as const
const DENSITY_ITEMS = {
  comfortable: "Comfortable",
  compact: "Compact",
} as const

export function ThemeDocumentEditor({
  theme,
  draft,
  saved,
}: {
  theme: ThemeRecord
  draft: Appearance
  saved: Appearance
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const setDraft = useAppearanceStore((s) => s.setDraft)
  const hydrateTheme = useAppearanceStore((s) => s.hydrateTheme)
  const markSaved = useAppearanceStore((s) => s.markSaved)
  const discardToSaved = useAppearanceStore((s) => s.discardToSaved)
  const magicOpen = useAppearanceStore((s) => s.open)
  const openMagic = useAppearanceStore((s) => s.openMagic)
  const closeMagic = useAppearanceStore((s) => s.closeMagic)
  const previewPaletteRole = useAppearanceStore((s) => s.previewPaletteRole)
  const previewPaletteExtra = useAppearanceStore((s) => s.previewPaletteExtra)
  const [nameState, setNameState] = useState(() => ({
    source: theme.name,
    value: theme.name,
  }))
  const [buffer, setBuffer] = useState<EditorBuffer>(() => ({
    source: draft,
    text: appearanceToJson(draft),
    parseError: null,
  }))
  const [jsonOpen, setJsonOpen] = useState(false)
  const [extraName, setExtraName] = useState("")

  if (nameState.source !== theme.name) {
    setNameState({
      source: theme.name,
      value:
        nameState.value === nameState.source ? theme.name : nameState.value,
    })
  }
  if (buffer.source !== draft) {
    const reconciled = reconcileEditorText(buffer.text, draft)
    setBuffer({
      source: draft,
      text: reconciled.text,
      parseError: reconciled.replaced ? null : buffer.parseError,
    })
  }
  if (buffer.parseError && !jsonOpen) setJsonOpen(true)

  const updateMutation = useMutation(
    trpc.workspace.updateTheme.mutationOptions({
      onSuccess: async (updated) => {
        toast.success("Theme saved")
        markSaved(updated.id, updated.document)
        await queryClient.invalidateQueries(
          trpc.workspace.getSettings.queryFilter()
        )
      },
      onError: (error) => toast.error(error.message || "Could not save theme"),
    })
  )

  function ensureTheme() {
    if (useAppearanceStore.getState().themeId !== theme.id) {
      hydrateTheme(theme.id, theme.document)
    }
  }

  function applyDocument(document: Appearance) {
    ensureTheme()
    setDraft(document)
  }

  function updateText(text: string) {
    try {
      const document = parseAppearance(JSON.parse(text))
      setBuffer({ source: buffer.source, text, parseError: null })
      applyDocument(document)
    } catch {
      setBuffer({ source: buffer.source, text, parseError: "Invalid JSON" })
    }
  }

  function save() {
    let document: Appearance
    try {
      document = parseAppearance(JSON.parse(buffer.text))
      setBuffer((current) => ({ ...current, parseError: null }))
    } catch (error) {
      setBuffer((current) => ({
        ...current,
        parseError:
          error instanceof Error ? error.message : "Invalid theme document",
      }))
      toast.error("Fix JSON before saving")
      return
    }
    updateMutation.mutate({
      id: theme.id,
      name: nameState.value,
      document,
    })
  }

  function addNamedExtra() {
    const name = extraName.trim()
    if (!name) return
    const id = newPaletteExtraId(draft, name)
    applyDocument(
      addPaletteExtra(draft, {
        id,
        name,
        value: draft.palette.accent,
      })
    )
    setExtraName("")
  }

  const invalid = buffer.parseError != null
  const dirty = (() => {
    if (isAppearanceDirty(draft, saved)) return true
    if (invalid) return false
    try {
      return isAppearanceDirty(parseAppearance(JSON.parse(buffer.text)), saved)
    } catch {
      return false
    }
  })()
  const canSave =
    !invalid &&
    !updateMutation.isPending &&
    (dirty || nameState.value !== theme.name)
  const jsonStatus = buffer.parseError
    ? buffer.parseError
    : updateMutation.isPending
      ? "Saving…"
      : dirty
        ? "Unsaved"
        : "Saved"

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div className="grid gap-1.5">
        <Label htmlFor="theme-name">Name</Label>
        <Input
          id="theme-name"
          value={nameState.value}
          onChange={(event) =>
            setNameState((current) => ({
              ...current,
              value: event.target.value,
            }))
          }
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="grid gap-1.5">
          <div className="flex items-center gap-1.5">
            <Label className="mb-0">This is a</Label>
            <TooltipProvider delay={200}>
              <WithTooltip
                side="top"
                label="For native scrollbars and markdown invert."
              >
                <button
                  type="button"
                  className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="About light and dark look"
                >
                  <HugeiconsIcon
                    icon={InformationCircleIcon}
                    className="size-3.5"
                    strokeWidth={2}
                  />
                </button>
              </WithTooltip>
            </TooltipProvider>
          </div>
          <Select
            value={draft.scheme}
            items={SCHEME_ITEMS}
            onValueChange={(value) => {
              if (value === "light" || value === "dark") {
                applyDocument({ ...draft, scheme: value })
              }
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light theme</SelectItem>
              <SelectItem value="dark">Dark theme</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Density</Label>
          <Select
            value={draft.density}
            items={DENSITY_ITEMS}
            onValueChange={(value) => {
              if (value === "comfortable" || value === "compact") {
                applyDocument({ ...draft, density: value })
              }
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="comfortable">Comfortable</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="mb-2 block text-xs text-muted-foreground">
          Palette
        </Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {PALETTE_ROLES.map((role, index) => (
            <PaletteColorField
              key={role}
              label={PALETTE_ROLE_LABELS[role]}
              value={draft.palette[role]}
              ensureTheme={ensureTheme}
              preview={(literal) => previewPaletteRole(role, literal)}
              align={index === PALETTE_ROLES.length - 1 ? "end" : "start"}
            />
          ))}
          {draft.palette.extras.map((extra) => (
            <PaletteColorField
              key={extra.id}
              label={extra.name ?? extra.id}
              value={extra.value}
              ensureTheme={ensureTheme}
              preview={(literal) => previewPaletteExtra(extra.id, literal)}
              onRemove={() =>
                applyDocument(removePaletteExtra(draft, extra.id))
              }
            />
          ))}
        </div>
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            addNamedExtra()
          }}
        >
          <Input
            value={extraName}
            onChange={(event) => setExtraName(event.target.value)}
            placeholder="Name a custom color"
            aria-label="New palette color name"
            className="h-8 max-w-[12rem]"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!extraName.trim()}
          >
            Add to palette
          </Button>
        </form>
      </div>

      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={magicOpen ? "default" : "outline"}
          onClick={() => {
            if (magicOpen) closeMagic()
            else openMagic()
          }}
        >
          {magicOpen ? "Done picking" : "Pick colors in the UI"}
        </Button>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {magicOpen
            ? "Click a surface to recolor it. The pencil pauses picking so you can use the app."
            : "Opens pick mode on the live workspace. Surfaces keep a palette color or a custom override."}
        </p>
      </div>

      <Collapsible
        open={jsonOpen}
        onOpenChange={setJsonOpen}
        className="group/json rounded-lg border border-border"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <span>
            Advanced · Theme JSON
            <span
              className={cn(
                "ml-2 text-[11px] font-normal",
                invalid
                  ? "text-danger"
                  : dirty
                    ? "text-amber-700"
                    : "text-muted-foreground"
              )}
            >
              {jsonStatus}
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-open/json:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted className="border-t border-border p-3">
          <CodeMirror
            value={buffer.text}
            onChange={updateText}
            extensions={[jsonLang()]}
            height="18rem"
            theme={draft.scheme === "dark" ? "dark" : "light"}
            className="overflow-hidden rounded-lg border border-border text-xs"
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={!canSave} onClick={save}>
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty}
          onClick={() => {
            discardToSaved()
            setBuffer({
              source: saved,
              text: appearanceToJson(saved),
              parseError: null,
            })
          }}
        >
          Discard
        </Button>
        <span
          className={cn(
            "text-[11px]",
            invalid
              ? "text-danger"
              : dirty
                ? "text-amber-700"
                : "text-muted-foreground"
          )}
        >
          {jsonStatus}
        </span>
      </div>
    </div>
  )
}
