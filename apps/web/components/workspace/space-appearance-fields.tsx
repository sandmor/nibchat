"use client"

import { useMemo, useState, type CSSProperties } from "react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  Delete02Icon,
  SquareLock01Icon,
  SquareUnlock01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useThemeSlot } from "@/components/theme-provider"
import { MessageParts } from "./message-parts"
import { MessageShell } from "./message-shell"
import { prepareMessageFooterHtml } from "@/lib/message-footer-html"
import { AppearanceJsonEditor } from "./settings/appearance-json-editor"
import {
  APPEARANCE_CONTROL_PATHS,
  AppearanceControls,
  appearanceControlValues,
  type AppearanceControlValues,
  type AppearanceFieldOverride,
} from "./settings/appearance-controls"
import { PaletteColorField } from "./settings/palette-color-field"
import {
  compileAppearance,
  type Appearance,
} from "@/lib/appearance"
import type { ThemeRecord } from "@/lib/appearance"
import { PALETTE_ROLES, PALETTE_ROLE_LABELS } from "@/lib/appearance-registry"
import { policyModeCopy, type PolicyMode } from "@/lib/chat-settings/policy"
import type { SpaceSettings } from "@/lib/spaces/settings"
import {
  flattenAppearancePatch,
  resolveSpaceAppearance,
  type AppearancePatch,
  type SpaceAppearance,
} from "@/lib/spaces/appearance"
import type { SpaceRecord } from "@/lib/spaces/tree"

type Branch = "shared" | "light" | "dark"

const BRANCH_LABEL: Record<Branch, string> = {
  shared: "Both",
  light: "Light",
  dark: "Dark",
}

const CONTROL_ROOTS = new Set([
  "scheme",
  "density",
  "radius",
  "motion",
  "messageActions",
  "messageLayout",
  "modelPicker",
])

const CONTROL_PATHS = new Set<string>(Object.values(APPEARANCE_CONTROL_PATHS))

function previewFooter(role: "user" | "assistant", captions: boolean) {
  const html = prepareMessageFooterHtml({
    captions,
    contextExcluded: false,
    contextPending: false,
    identity: {
      label: role === "assistant" ? "Preview model" : null,
      title: null,
      hasDetails: role === "assistant",
      createdTime: null,
      providerName: role === "assistant" ? "Preview" : null,
      modelName: role === "assistant" ? "preview" : null,
    },
    showDetailsAction: false,
    showEdit: role === "user",
    generate: role === "user" ? "answer" : null,
    siblingCount: role === "assistant" ? 2 : 1,
    siblingIndex: 0,
  })
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="contents" dangerouslySetInnerHTML={html.identity} />
      <span className="contents" dangerouslySetInnerHTML={html.actions} />
    </div>
  )
}

function AppearanceMessagePreview({ document }: { document: Appearance }) {
  return (
    <>
      <MessageShell role="user" layout={document.messageLayout.user}>
        <MessageParts parts={[{ type: "text", text: "Can you make this shorter?" }]} />
        {previewFooter("user", document.messageActions.captions)}
      </MessageShell>
      <MessageShell role="assistant" layout={document.messageLayout.assistant}>
        <MessageParts
          parts={[
            {
              type: "text",
              text: "Here is a **shorter** version, with `code` and a list:\n\n- First point\n- Second point",
            },
          ]}
        />
        {previewFooter("assistant", document.messageActions.captions)}
      </MessageShell>
    </>
  )
}

function omitPointer(
  values: Record<string, unknown>,
  path: string
): Record<string, unknown> {
  const parts = path.slice(1).split("/")
  const clone = structuredClone(values)
  const stack: Array<Record<string, unknown>> = []
  let cursor: unknown = clone
  for (let index = 0; index < parts.length - 1; index++) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor))
      return values
    const record = cursor as Record<string, unknown>
    stack.push(record)
    cursor = record[parts[index]!]
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor))
    return values
  delete (cursor as Record<string, unknown>)[parts.at(-1)!]
  for (let index = stack.length - 1; index >= 0; index--) {
    const parent = stack[index]!
    const key = parts[index]!
    const child = parent[key]
    if (
      child &&
      typeof child === "object" &&
      !Array.isArray(child) &&
      Object.keys(child).length === 0
    ) {
      delete parent[key]
    }
  }
  return clone
}

function controlValues(
  baseline: Appearance,
  next: AppearanceControlValues
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  if (next.scheme && next.scheme !== baseline.scheme) values.scheme = next.scheme
  if (next.density && next.density !== baseline.density)
    values.density = next.density
  if (next.radius && next.radius !== baseline.radius) values.radius = next.radius
  const motion: Record<string, unknown> = {}
  const nextMotion = next.motion ?? {}
  if (
    nextMotion.enabled !== undefined &&
    nextMotion.enabled !== baseline.motion.enabled
  )
    motion.enabled = nextMotion.enabled
  if (
    nextMotion.durationMs !== undefined &&
    nextMotion.durationMs !== baseline.motion.durationMs
  )
    motion.durationMs = nextMotion.durationMs
  if (nextMotion.ease !== undefined && nextMotion.ease !== baseline.motion.ease)
    motion.ease = nextMotion.ease
  if (
    nextMotion.reducedMotion !== undefined &&
    nextMotion.reducedMotion !== baseline.motion.reducedMotion
  )
    motion.reducedMotion = nextMotion.reducedMotion
  if (Object.keys(motion).length) values.motion = motion
  if (
    next.messageActions?.captions !== undefined &&
    next.messageActions.captions !== baseline.messageActions.captions
  ) {
    values.messageActions = { captions: next.messageActions.captions }
  }
  const layout: Record<string, unknown> = {}
  for (const role of ["user", "assistant"] as const) {
    const edited = next.messageLayout?.[role]
    const base = baseline.messageLayout[role]
    const rolePatch: Record<string, unknown> = {}
    if (edited?.align && edited.align !== base.align) rolePatch.align = edited.align
    if (
      edited?.maxWidthPercent != null &&
      edited.maxWidthPercent !== base.maxWidthPercent
    )
      rolePatch.maxWidthPercent = edited.maxWidthPercent
    if (Object.keys(rolePatch).length) layout[role] = rolePatch
  }
  if (Object.keys(layout).length) values.messageLayout = layout
  if (
    next.modelPicker?.showIds !== undefined &&
    next.modelPicker.showIds !== baseline.modelPicker.showIds
  ) {
    values.modelPicker = { showIds: next.modelPicker.showIds }
  }
  return values
}

function leafValue(document: Appearance, path: string): unknown {
  const parts = path.slice(1).split("/")
  let cursor: unknown = document
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function setLeaf(
  values: Record<string, unknown>,
  path: string,
  value: unknown
): Record<string, unknown> {
  const parts = path.slice(1).split("/")
  const clone = structuredClone(values)
  let cursor = clone
  for (const part of parts.slice(0, -1)) {
    const child = cursor[part]
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      cursor[part] = {}
    }
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts.at(-1)!] = value
  return clone
}

function ThemeChoice({
  label,
  slot,
  appearance,
  themes,
  fallback,
  onChange,
}: {
  label: string
  slot: "lightTheme" | "darkTheme"
  appearance: SpaceAppearance
  themes: ThemeRecord[]
  fallback: string
  onChange: (next: SpaceAppearance) => void
}) {
  const policy = appearance[slot]
  const fallbackName =
    themes.find((theme) => theme.id === fallback)?.name ?? "theme"
  if (!policy) {
    return (
      <div className="grid gap-2">
        <Label>{label} base theme</Label>
        <Select
          value="inherit"
          items={{
            inherit: fallbackName,
            ...Object.fromEntries(themes.map((theme) => [theme.id, theme.name])),
          }}
          onValueChange={(id) => {
            if (!id || id === "inherit") return
            onChange({
              ...appearance,
              [slot]: { mode: "default", value: id },
            })
          }}
        >
          <SelectTrigger aria-label={`${label} theme`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">{fallbackName}</SelectItem>
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
  return (
    <div
      className={cn(
        "grid gap-3 rounded-2xl border bg-background/40 p-3",
        policy.mode === "release" && "border-dashed opacity-80"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <HugeiconsIcon
          icon={policy.mode === "require" ? SquareLock01Icon : SquareUnlock01Icon}
          strokeWidth={2}
          className="ms-2 size-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label} base theme</p>
          <p className="text-[11px] text-muted-foreground">
            {policyModeCopy(policy.mode)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${label} base theme`}
          onClick={() => onChange({ ...appearance, [slot]: undefined })}
        >
          <HugeiconsIcon icon={Delete02Icon} className="size-4" />
        </Button>
      </div>
      <div role="group" aria-label={`${label} theme policy`} className="ms-10">
        <ToggleGroup
          value={[policy.mode]}
          onValueChange={(next) => {
            const mode = next[0]
            if (mode !== "default" && mode !== "require" && mode !== "release")
              return
            onChange({ ...appearance, [slot]: { ...policy, mode } })
          }}
          variant="outline"
          size="sm"
          spacing={0}
        >
          <ToggleGroupItem value="default">Default</ToggleGroupItem>
          <ToggleGroupItem value="require">Require</ToggleGroupItem>
          <ToggleGroupItem value="release">Release</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {policy.mode !== "release" && (
        <div className="ps-10">
          <Select
            value={policy.value}
            items={Object.fromEntries(
              themes.map((theme) => [theme.id, theme.name])
            )}
            onValueChange={(id) => {
              if (!id) return
              onChange({ ...appearance, [slot]: { ...policy, value: id } })
            }}
          >
            <SelectTrigger aria-label={`${label} theme`}>
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
      )}
    </div>
  )
}

function BranchAdvanced({
  branch,
  patch,
  onChange,
}: {
  branch: Branch
  patch: AppearancePatch
  onChange: (next: AppearancePatch) => void
}) {
  const serialized = JSON.stringify(patch.values ?? {}, null, 2)
  const [text, setText] = useState(serialized)
  const [source, setSource] = useState(serialized)
  if (source !== serialized) {
    setSource(serialized)
    setText(serialized)
  }
  const policies = patch.policies ?? {}
  const paths = [
    ...new Set([
      ...flattenAppearancePatch(patch.values ?? {}).map(([key]) => key),
      ...Object.keys(policies),
    ]),
  ].filter((path) => !CONTROL_PATHS.has(path) && !path.startsWith("/palette/"))
  return (
    <Collapsible className="rounded-xl border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium">
        Advanced
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          className="size-4 text-muted-foreground"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 border-t p-3">
        <label className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block">Start from the base theme</span>
            <span className="block text-[11px] text-muted-foreground">
              Parent appearance changes will not apply here.
            </span>
          </span>
          <Switch
            size="sm"
            checked={patch.reset ?? false}
            onCheckedChange={(reset) => onChange({ ...patch, reset })}
            aria-label={`${BRANCH_LABEL[branch]} ignore parent appearance`}
          />
        </label>
        <AppearanceJsonEditor
          value={text}
          onChange={setText}
          ariaLabel={`${BRANCH_LABEL[branch]} appearance JSON`}
          onBlur={() => {
            try {
              const parsed: unknown = JSON.parse(text)
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
                throw new Error("Expected an object")
              if (JSON.stringify(parsed) === JSON.stringify(patch.values ?? {}))
                return
              onChange({ ...patch, values: parsed as Record<string, unknown> })
            } catch {
              toast.error("Fix the appearance JSON before saving")
            }
          }}
        />
        {paths.length > 0 ? (
          <div className="space-y-2">
            <Label>Value policies</Label>
            {paths.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {key}
                </span>
                <Select
                  value={policies[key] ?? "default"}
                  onValueChange={(next) => {
                    if (next !== "default" && next !== "require" && next !== "release")
                      return
                    onChange({
                      ...patch,
                      policies: { ...policies, [key]: next },
                    })
                  }}
                >
                  <SelectTrigger aria-label={`Policy for ${key}`} className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="require">Require</SelectItem>
                    <SelectItem value="release">Release</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SpaceAppearanceFields({
  settings,
  themes,
  lightThemeId,
  darkThemeId,
  spaceId,
  spaces,
  onChange,
  onRemove,
}: {
  settings: SpaceSettings
  themes: ThemeRecord[]
  lightThemeId: string
  darkThemeId: string
  spaceId: string
  spaces: SpaceRecord[]
  onChange: (
    next: SpaceSettings | ((current: SpaceSettings) => SpaceSettings)
  ) => void
  onRemove?: () => void
}) {
  const { resolved: activeSlot } = useThemeSlot()
  const appearance = settings.appearance ?? {}
  const setAppearance = (next: SpaceAppearance) =>
    onChange((current) => ({ ...current, appearance: next }))
  const parentId =
    spaces.find((space) => space.id === spaceId)?.parent_id ?? null
  const inheritedLightId = resolveSpaceAppearance({
    spaceId: parentId,
    spaces,
    slot: "light",
    userThemeId: lightThemeId,
    themes,
  }).themeId
  const inheritedDarkId = resolveSpaceAppearance({
    spaceId: parentId,
    spaces,
    slot: "dark",
    userThemeId: darkThemeId,
    themes,
  }).themeId
  const [previewSlot, setPreviewSlot] = useState<"light" | "dark">(activeSlot)
  const [editorBranch, setEditorBranch] = useState<Branch>("shared")
  const [customizing, setCustomizing] = useState(
    () => Boolean(appearance.shared || appearance.light || appearance.dark)
  )
  const [dragDocument, setDragDocument] = useState<Appearance | null>(null)
  const resolvedBySlot = useMemo(() => {
    const currentSpaces = spaces.map((space) =>
      space.id === spaceId ? { ...space, settings } : space
    )
    return {
      light: resolveSpaceAppearance({
        spaceId,
        spaces: currentSpaces,
        slot: "light",
        userThemeId: lightThemeId,
        themes,
      }),
      dark: resolveSpaceAppearance({
        spaceId,
        spaces: currentSpaces,
        slot: "dark",
        userThemeId: darkThemeId,
        themes,
      }),
    }
  }, [spaceId, spaces, settings, lightThemeId, darkThemeId, themes])

  function documentFor(nextAppearance: SpaceAppearance, slot: "light" | "dark") {
    const currentSpaces = spaces.map((space) =>
      space.id === spaceId
        ? { ...space, settings: { ...settings, appearance: nextAppearance } }
        : space
    )
    return resolveSpaceAppearance({
      spaceId,
      spaces: currentSpaces,
      slot,
      userThemeId: slot === "light" ? lightThemeId : darkThemeId,
      themes,
    }).document
  }

  function commitPatch(branch: Branch, patch: AppearancePatch) {
    const valuePaths = new Set(
      flattenAppearancePatch(patch.values ?? {}).map(([key]) => key)
    )
    const policies = Object.fromEntries(
      Object.entries(patch.policies ?? {}).filter(
        ([key, mode]) => mode === "release" || valuePaths.has(key)
      )
    )
    const empty =
      !patch.reset &&
      Object.keys(patch.values ?? {}).length === 0 &&
      Object.keys(policies).length === 0
    setAppearance({
      ...appearance,
      [branch]: empty ? undefined : { ...patch, policies },
    })
  }

  function baselineDocument(branch: Branch) {
    const patch = appearance[branch]
    const stripped: SpaceAppearance = {
      ...appearance,
      [branch]: patch
        ? { reset: patch.reset, policies: patch.policies }
        : undefined,
    }
    return documentFor(stripped, branch === "shared" ? previewSlot : branch)
  }

  function setPathPolicy(branch: Branch, path: string, mode: PolicyMode) {
    const patch = appearance[branch] ?? {}
    const values = patch.values ?? {}
    const hasValue = flattenAppearancePatch(values).some(([key]) => key === path)
    let nextValues = values
    if (mode !== "release" && !hasValue) {
      const shown =
        dragDocument ??
        resolvedBySlot[branch === "shared" ? previewSlot : branch].document
      const leaf = leafValue(shown, path)
      if (leaf === undefined) {
        toast.error("Set a value before applying")
        return
      }
      nextValues = setLeaf(values, path, leaf)
    }
    commitPatch(branch, {
      ...patch,
      values: nextValues,
      policies: { ...patch.policies, [path]: mode },
    })
  }

  function resetPath(branch: Branch, path: string) {
    const patch = appearance[branch] ?? {}
    const policies = { ...patch.policies }
    delete policies[path]
    commitPatch(branch, {
      ...patch,
      values: omitPointer(patch.values ?? {}, path),
      policies,
    })
  }

  function fieldOverrides(branch: Branch): Record<string, AppearanceFieldOverride> {
    const patch = appearance[branch] ?? {}
    const paths = new Set([
      ...flattenAppearancePatch(patch.values ?? {}).map(([key]) => key),
      ...Object.keys(patch.policies ?? {}),
    ])
    const overrides: Record<string, AppearanceFieldOverride> = {}
    for (const path of paths) {
      if (!CONTROL_PATHS.has(path)) continue
      overrides[path] = {
        policy: patch.policies?.[path] ?? "default",
        onPolicy: (mode) => setPathPolicy(branch, path, mode),
        onReset: () => resetPath(branch, path),
      }
    }
    return overrides
  }

  const editorSlot = editorBranch === "shared" ? previewSlot : editorBranch
  const editorDocument = documentFor(appearance, editorSlot)
  const preview = resolvedBySlot[previewSlot]
  const shown = dragDocument ?? preview.document
  const previewVars = compileAppearance(shown) as CSSProperties
  const themeName =
    themes.find((theme) => theme.id === preview.themeId)?.name ?? "Theme"
  const patch = appearance[editorBranch] ?? {}
  const palette = (patch.values?.palette ?? {}) as Record<string, string>
  const overriddenRoles = PALETTE_ROLES.filter((role) => {
    const shared = appearance.shared?.values?.palette as
      | Record<string, string>
      | undefined
    const specific = appearance[previewSlot]?.values?.palette as
      | Record<string, string>
      | undefined
    return shared?.[role] !== undefined || specific?.[role] !== undefined
  })

  return (
    <div className="grid gap-3 rounded-2xl border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Appearance</h3>
          <p className="text-xs text-muted-foreground">
            Choose base themes, then layer changes for both modes or one mode.
          </p>
        </div>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label="Remove appearance"
            onClick={onRemove}
          >
            <HugeiconsIcon icon={Delete02Icon} className="size-4" />
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ThemeChoice
          label="Light"
          slot="lightTheme"
          appearance={appearance}
          themes={themes}
          fallback={inheritedLightId}
          onChange={setAppearance}
        />
        <ThemeChoice
          label="Dark"
          slot="darkTheme"
          appearance={appearance}
          themes={themes}
          fallback={inheritedDarkId}
          onChange={setAppearance}
        />
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] text-muted-foreground">Theme</dt>
          <dd className="text-sm">{themeName}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Density</dt>
          <dd className="text-sm capitalize">{shown.density}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Palette</dt>
          <dd className="text-sm">
            {overriddenRoles.length
              ? overriddenRoles
                  .map((role) => PALETTE_ROLE_LABELS[role])
                  .join(", ")
              : "Inherited"}
          </dd>
        </div>
      </dl>
      <div className="grid gap-2 rounded-xl border p-3">
        <div className="flex items-center justify-between gap-2">
          <Label>Preview as</Label>
          <Select
            value={previewSlot}
            items={{ light: "Light", dark: "Dark" }}
            onValueChange={(next) => {
              setDragDocument(null)
              setPreviewSlot(next as "light" | "dark")
            }}
          >
            <SelectTrigger aria-label="Preview as" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div
          style={previewVars}
          data-density={shown.density}
          className={cn(
            "grid gap-3 rounded-xl border bg-background p-4 text-foreground",
            shown.scheme === "dark" && "dark"
          )}
        >
          <AppearanceMessagePreview document={shown} />
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => setCustomizing((open) => !open)}
      >
        {customizing ? "Hide customize" : "Customize"}
      </Button>
      {customizing ? (
        <div className="grid gap-3 rounded-xl border p-3">
          <ToggleGroup
            value={[editorBranch]}
            onValueChange={(next) => {
              const branch = next[0]
              if (branch === "shared" || branch === "light" || branch === "dark")
                setEditorBranch(branch)
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Appearance branch"
          >
            <ToggleGroupItem value="shared">Both</ToggleGroupItem>
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
          <AppearanceControls
            idPrefix={BRANCH_LABEL[editorBranch]}
            values={appearanceControlValues(editorDocument)}
            overrides={fieldOverrides(editorBranch)}
            onChange={(next) => {
              const previous = patch.values ?? {}
              const rest = Object.fromEntries(
                Object.entries(previous).filter(([key]) => !CONTROL_ROOTS.has(key))
              )
              const written = controlValues(baselineDocument(editorBranch), next)
              const policies = { ...patch.policies }
              for (const [path] of flattenAppearancePatch(written)) {
                if (policies[path] === "release") delete policies[path]
              }
              commitPatch(editorBranch, {
                ...patch,
                values: { ...rest, ...written },
                policies,
              })
            }}
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {PALETTE_ROLES.map((role) => {
              const path = `/palette/${role}`
              const overridden = palette[role] !== undefined || patch.policies?.[path] != null
              return (
                <PaletteColorField
                  key={role}
                  label={PALETTE_ROLE_LABELS[role]}
                  value={palette[role] ?? editorDocument.palette[role]}
                  marked={overridden}
                  ensureTheme={() => undefined}
                  preview={(literal) => {
                    const document = structuredClone(preview.document)
                    document.palette = { ...document.palette, [role]: literal }
                    setDragDocument(document)
                  }}
                  onCommit={() => {
                    const literal = dragDocument?.palette[role]
                    const current =
                      palette[role] ?? preview.document.palette[role]
                    setDragDocument(null)
                    if (!literal || literal === current) return
                    const policies = { ...patch.policies }
                    if (policies[path] === "release") delete policies[path]
                    commitPatch(editorBranch, {
                      ...patch,
                      values: {
                        ...patch.values,
                        palette: { ...palette, [role]: literal },
                      },
                      policies,
                    })
                  }}
                  onDiscard={() => setDragDocument(null)}
                  onRemove={
                    overridden
                      ? () => resetPath(editorBranch, path)
                      : undefined
                  }
                  removeLabel="Use inherited"
                  policy={overridden ? (patch.policies?.[path] ?? "default") : undefined}
                  onPolicy={
                    overridden
                      ? (mode) => setPathPolicy(editorBranch, path, mode)
                      : undefined
                  }
                />
              )
            })}
          </div>
          <BranchAdvanced
            key={editorBranch}
            branch={editorBranch}
            patch={patch}
            onChange={(next) => commitPatch(editorBranch, next)}
          />
        </div>
      ) : null}
    </div>
  )
}
