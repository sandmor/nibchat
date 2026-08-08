"use client"

import { useRef, useState } from "react"
import CodeMirror from "@uiw/react-codemirror"
import { json as jsonLang } from "@codemirror/lang-json"
import { toast } from "sonner"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
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
  parseAppearance,
  presetDocument,
  presetTemplates,
} from "@/lib/appearance"

export function AppearanceSettings({
  appearance,
  onChange,
}: {
  appearance: ResolvedAppearance
  onChange: (next: ResolvedAppearance) => void
}) {
  const trpc = useTRPC()
  /** Last document successfully written to the server. */
  const savedRef = useRef(appearance)
  const [text, setText] = useState(() => appearanceToJson(appearance))
  const [parseError, setParseError] = useState<string | null>(null)
  const [status, setStatus] = useState<
    "clean" | "preview" | "invalid" | "saving" | "saved"
  >("clean")
  /** Parsed draft currently shown as live preview (may differ from saved). */
  const previewRef = useRef<Appearance | null>(null)

  const save = useMutation(trpc.workspace.setAppearance.mutationOptions())

  function sameDoc(a: Appearance, b: Appearance) {
    return appearanceToJson(a, false) === appearanceToJson(b, false)
  }

  /** Live preview only — never persists. */
  function previewDoc(doc: Appearance) {
    previewRef.current = doc
    onChange(doc)
    if (sameDoc(doc, savedRef.current)) {
      setStatus("clean")
      return
    }
    setStatus("preview")
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
      setStatus("invalid")
      toast.error("Fix JSON before saving")
      return
    }
    setText(appearanceToJson(doc))
    previewRef.current = doc
    onChange(doc)
    if (sameDoc(doc, savedRef.current)) {
      setStatus("clean")
      toast.success("Already saved")
      return
    }
    setStatus("saving")
    save.mutate(doc, {
      onSuccess: (next) => {
        if (!next) return
        savedRef.current = next
        previewRef.current = next
        setText(appearanceToJson(next))
        setStatus("saved")
        onChange(next)
      },
      onError: (error) => {
        setStatus(previewRef.current ? "preview" : "clean")
        toast.error(error.message || "Could not save appearance")
      },
    })
  }

  function discardToSaved() {
    const saved = savedRef.current
    previewRef.current = saved
    setText(appearanceToJson(saved))
    setParseError(null)
    setStatus("clean")
    onChange(saved)
  }

  function loadPreset(id: (typeof PRESET_IDS)[number]) {
    const doc = presetDocument(id)
    setText(appearanceToJson(doc))
    setParseError(null)
    previewDoc(doc)
  }

  function onEditorChange(next: string) {
    setText(next)
    let parsed: unknown
    try {
      parsed = JSON.parse(next)
    } catch {
      setParseError("Invalid JSON")
      setStatus("invalid")
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
      setStatus("invalid")
      return
    }

    previewDoc(doc)
  }

  const statusLabel =
    parseError || status === "invalid"
      ? (parseError ?? "Invalid JSON")
      : status === "saving"
        ? "Saving…"
        : status === "saved"
          ? "Saved"
          : status === "preview"
            ? "Preview · unsaved"
            : "Saved"

  const dirty = status === "preview" || status === "invalid"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Valid JSON and presets preview live only in this session. Nothing is
          written until you save. Discard restores the last saved document.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
                status === "invalid" || parseError
                  ? "text-destructive"
                  : status === "preview"
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
            <code className="text-[11px]">remoteStylesheet</code>,{" "}
            <code className="text-[11px]">vars</code> (CSS custom properties →
            :root).
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={status === "invalid" || status === "saving" || !dirty}
            onClick={saveNow}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={status === "saving" || !dirty}
            onClick={discardToSaved}
          >
            Discard preview
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
