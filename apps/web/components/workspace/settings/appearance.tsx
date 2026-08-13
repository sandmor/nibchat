"use client"

import { useEffect, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { json as jsonLang } from "@codemirror/lang-json"
import { toast } from "sonner"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/lib/trpc-react"
import type { Appearance, ResolvedAppearance } from "@/lib/appearance"
import {
  PRESET_IDS,
  appearanceToJson,
  applyAppearancePreset,
  parseAppearance,
  presetTemplates,
} from "@/lib/appearance"
import { reconcileEditorText } from "@/lib/appearance-editor-sync"
import {
  isAppearanceDirty,
  useAppearanceStore,
} from "@/lib/appearance-store"

export function AppearanceSettings({
  appearance,
  onChange,
}: {
  appearance: ResolvedAppearance
  onChange: (next: ResolvedAppearance) => void
}) {
  const trpc = useTRPC()
  const magicOpen = useAppearanceStore((s) => s.open)
  const storeDraft = useAppearanceStore((s) => s.draft)
  const storeSaved = useAppearanceStore((s) => s.saved)
  const openMagic = useAppearanceStore((s) => s.openMagic)
  const closeMagic = useAppearanceStore((s) => s.closeMagic)
  const markSaved = useAppearanceStore((s) => s.markSaved)
  const discardToSaved = useAppearanceStore((s) => s.discardToSaved)

  const effectiveDraft = storeDraft ?? appearance
  const effectiveSaved = storeSaved ?? appearance
  const dirty = isAppearanceDirty(effectiveDraft, effectiveSaved)

  const [text, setText] = useState(() => appearanceToJson(effectiveDraft))
  const [parseError, setParseError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = useMutation(trpc.workspace.setAppearance.mutationOptions())

  // Store draft is SOT: rewrite editor when external draft changes (preserve format if equal).
  useEffect(() => {
    setText((prev) => {
      const { text: next, replaced } = reconcileEditorText(prev, effectiveDraft)
      if (replaced) setParseError(null)
      return next
    })
  }, [effectiveDraft])

  function applyDoc(doc: Appearance) {
    onChange(doc)
  }

  function saveNow() {
    let doc: Appearance
    try {
      doc = parseAppearance(JSON.parse(text))
      setParseError(null)
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Invalid appearance document"
      )
      toast.error("Fix JSON before saving")
      return
    }
    setText(appearanceToJson(doc))
    applyDoc(doc)
    if (!isAppearanceDirty(doc, effectiveSaved)) {
      toast.success("Already saved")
      return
    }
    setSaving(true)
    save.mutate(doc, {
      onSuccess: (next) => {
        setSaving(false)
        if (!next) return
        markSaved(next)
        setText(appearanceToJson(next))
        applyDoc(next)
        toast.success("Appearance saved")
      },
      onError: (error) => {
        setSaving(false)
        toast.error(error.message || "Could not save appearance")
      },
    })
  }

  function discardPreview() {
    discardToSaved()
    const saved = useAppearanceStore.getState().saved ?? effectiveSaved
    setText(appearanceToJson(saved))
    setParseError(null)
    applyDoc(saved)
  }

  function loadPreset(id: (typeof PRESET_IDS)[number]) {
    const doc = applyAppearancePreset(
      effectiveDraft,
      presetTemplates[id].document
    )
    setText(appearanceToJson(doc))
    setParseError(null)
    applyDoc(doc)
  }

  function onEditorChange(next: string) {
    setText(next)
    let parsed: unknown
    try {
      parsed = JSON.parse(next)
    } catch {
      setParseError("Invalid JSON")
      return
    }

    let doc: Appearance
    try {
      doc = parseAppearance(parsed)
      setParseError(null)
    } catch (error) {
      setParseError(
        error instanceof Error ? error.message : "Invalid appearance document"
      )
      return
    }

    applyDoc(doc)
  }

  const statusLabel = parseError
    ? parseError
    : saving
      ? "Saving…"
      : dirty
        ? "Preview · unsaved"
        : "Saved"

  const invalid = parseError != null
  // Save when dirty, or when invalid so user can't save broken JSON, or when fixed-but-need-reentry — dirty only
  const canSave = !invalid && !saving && dirty
  const canDiscard = !saving && dirty

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Valid JSON and starters preview live only in this session. Starters
          resolve into the current document; the editor shows that JSON, not a
          patch. Nothing is written until you save. Discard restores the last
          saved document.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-3">
          <div className="min-w-0">
            <Label htmlFor="magic-editor" className="text-sm font-medium">
              Magic editor
            </Label>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Floating pick mode: recolor tagged surfaces. Survives navigation
              until you close or save.
            </p>
          </div>
          <Switch
            id="magic-editor"
            checked={magicOpen}
            onCheckedChange={(checked) => {
              if (checked) openMagic()
              else closeMagic()
            }}
          />
        </div>

        <div>
          <Label className="mb-2 block text-xs text-muted-foreground">
            Load starter
          </Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {PRESET_IDS.map((id) => {
              const preset = presetTemplates[id]
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => loadPreset(id)}
                  className="rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="block text-sm font-medium">
                    {preset.name}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    {preset.description}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label>Appearance JSON</Label>
            <span
              className={cn(
                "text-[11px]",
                invalid
                  ? "text-destructive"
                  : dirty
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground"
              )}
            >
              {statusLabel}
            </span>
          </div>
          <CodeMirror
            value={text}
            onChange={onEditorChange}
            extensions={[jsonLang()]}
            height="22rem"
            className="overflow-hidden rounded-lg border bg-background text-xs text-foreground"
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Known keys: <code className="text-[11px]">density</code>,{" "}
            <code className="text-[11px]">motion</code> (
            <code className="text-[11px]">enabled</code>,{" "}
            <code className="text-[11px]">durationMs</code>,{" "}
            <code className="text-[11px]">ease</code>,{" "}
            <code className="text-[11px]">reducedMotion</code>),{" "}
            <code className="text-[11px]">messageActions</code> (
            <code className="text-[11px]">captions</code>),{" "}
            <code className="text-[11px]">modelPicker</code> (
            <code className="text-[11px]">showIds</code>),{" "}
            <code className="text-[11px]">remoteStylesheet</code>,{" "}
            <code className="text-[11px]">vars</code> (CSS custom properties →
            :root). In a starter, <code className="text-[11px]">null</code>{" "}
            removes a key.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canSave}
            onClick={saveNow}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canDiscard}
            onClick={discardPreview}
          >
            Discard preview
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
