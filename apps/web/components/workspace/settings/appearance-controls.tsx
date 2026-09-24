"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  NAMED_MOTION_EASES,
  namedMotionEase,
  type Appearance,
  type AppearanceMotion,
} from "@/lib/appearance"
import type { PolicyMode } from "@/lib/chat-settings/policy"

type Align = "left" | "center" | "right"
type Scheme = "light" | "dark"
type Density = "comfortable" | "compact"

export type AppearanceControlValues = {
  scheme?: Scheme
  density?: Density
  radius?: string
  motion?: Partial<AppearanceMotion>
  messageActions?: { captions?: boolean }
  messageLayout?: {
    user?: { align?: Align; maxWidthPercent?: number }
    assistant?: { align?: Align; maxWidthPercent?: number }
  }
  modelPicker?: { showIds?: boolean }
}

export type AppearanceFieldOverride = {
  policy: PolicyMode
  onPolicy: (mode: PolicyMode) => void
  onReset: () => void
}

export const APPEARANCE_CONTROL_PATHS = {
  scheme: "/scheme",
  density: "/density",
  radius: "/radius",
  motionEnabled: "/motion/enabled",
  motionDuration: "/motion/durationMs",
  motionEase: "/motion/ease",
  motionReduced: "/motion/reducedMotion",
  captions: "/messageActions/captions",
  showIds: "/modelPicker/showIds",
  userAlign: "/messageLayout/user/align",
  userWidth: "/messageLayout/user/maxWidthPercent",
  assistantAlign: "/messageLayout/assistant/align",
  assistantWidth: "/messageLayout/assistant/maxWidthPercent",
} as const

const EASE_LABELS: Record<(typeof NAMED_MOTION_EASES)[number], string> = {
  linear: "Linear",
  ease: "Ease",
  "ease-in": "Ease in",
  "ease-out": "Ease out",
  "ease-in-out": "Ease in out",
}

function ChoiceField<T extends string>({
  label,
  hint,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label?: string
  hint?: string
  ariaLabel: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="grid gap-1.5">
      {label ? <Label>{label}</Label> : null}
      {hint ? (
        <p className="text-[11px] leading-5 text-muted-foreground">{hint}</p>
      ) : null}
      <ToggleGroup
        value={[value]}
        onValueChange={(next) => {
          const chosen = next[0]
          if (typeof chosen === "string" && chosen !== value) onChange(chosen as T)
        }}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label={ariaLabel}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function RangeField({
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  ariaLabel: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <div className="grid min-w-40 flex-1 gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        <span className="text-[11px] text-muted-foreground">{format(value)}</span>
      </div>
      <Slider
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => {
          const amount = Array.isArray(next) ? next[0] : next
          if (typeof amount === "number") onChange(amount)
        }}
      />
    </div>
  )
}

function radiusRem(value: string | undefined): number | null {
  if (!value) return null
  const match = value.trim().match(/^(\d+(?:\.\d+)?)rem$/)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount < 0 || amount > 1.5) return null
  return Math.round(amount * 100) / 100
}

function FieldOverride({
  override,
  children,
}: {
  override?: AppearanceFieldOverride
  children: ReactNode
}) {
  if (!override) return children
  return (
    <div className="grid gap-2">
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          value={[override.policy]}
          onValueChange={(next) => {
            const mode = next[0]
            if (mode !== "default" && mode !== "require" && mode !== "release")
              return
            override.onPolicy(mode)
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Value policy"
        >
          <ToggleGroupItem value="default">Default</ToggleGroupItem>
          <ToggleGroupItem value="require">Require</ToggleGroupItem>
          <ToggleGroupItem value="release">Release</ToggleGroupItem>
        </ToggleGroup>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={override.onReset}
        >
          Use inherited
        </Button>
      </div>
    </div>
  )
}

export function AppearanceControls({
  idPrefix,
  values,
  overrides,
  onChange,
}: {
  idPrefix: string
  values: AppearanceControlValues
  overrides?: Partial<Record<string, AppearanceFieldOverride>>
  onChange: (values: AppearanceControlValues) => void
}) {
  const motion = values.motion ?? {}
  const easeName = namedMotionEase(motion.ease ?? "ease")
  const radiusAmount = radiusRem(values.radius)
  const customRadius = Boolean(values.radius) && radiusAmount == null

  function patch(next: AppearanceControlValues) {
    onChange({ ...values, ...next })
  }

  function patchMotion(next: Partial<AppearanceMotion>) {
    patch({ motion: { ...motion, ...next } })
  }

  function patchRole(
    role: "user" | "assistant",
    next: { align?: Align; maxWidthPercent?: number }
  ) {
    patch({
      messageLayout: {
        ...values.messageLayout,
        [role]: { ...values.messageLayout?.[role], ...next },
      },
    })
  }

  return (
    <div className="grid gap-4">
      <FieldOverride override={overrides?.[APPEARANCE_CONTROL_PATHS.scheme]}>
        <ChoiceField
          label="Scheme"
          hint="For native scrollbars and markdown invert. Separate from the app light and dark mode."
          ariaLabel={`${idPrefix} scheme`}
          value={values.scheme ?? "light"}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(scheme) => patch({ scheme })}
        />
      </FieldOverride>
      <FieldOverride override={overrides?.[APPEARANCE_CONTROL_PATHS.density]}>
        <ChoiceField
          label="Density"
          ariaLabel={`${idPrefix} density`}
          value={values.density ?? "comfortable"}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
          onChange={(density) => patch({ density })}
        />
      </FieldOverride>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["user", "assistant"] as const).map((role) => {
          const layout = values.messageLayout?.[role]
          const align = layout?.align
          const alignPath =
            role === "user"
              ? APPEARANCE_CONTROL_PATHS.userAlign
              : APPEARANCE_CONTROL_PATHS.assistantAlign
          const widthPath =
            role === "user"
              ? APPEARANCE_CONTROL_PATHS.userWidth
              : APPEARANCE_CONTROL_PATHS.assistantWidth
          return (
            <div key={role} className="grid gap-3 rounded-xl border p-3">
              <p className="text-sm font-medium capitalize">{role} messages</p>
              <FieldOverride override={overrides?.[alignPath]}>
                <ChoiceField
                  label="Align"
                  ariaLabel={`${idPrefix} ${role} alignment`}
                  value={align ?? (role === "user" ? "right" : "left")}
                  options={[
                    { value: "left", label: "Left" },
                    { value: "center", label: "Center" },
                    { value: "right", label: "Right" },
                  ]}
                  onChange={(next) => patchRole(role, { align: next })}
                />
              </FieldOverride>
              <FieldOverride override={overrides?.[widthPath]}>
                <RangeField
                  label="Max width"
                  ariaLabel={`${idPrefix} ${role} message maximum width percent`}
                  value={layout?.maxWidthPercent ?? (role === "user" ? 88 : 100)}
                  min={20}
                  max={100}
                  step={1}
                  format={(amount) => `${amount}%`}
                  onChange={(maxWidthPercent) =>
                    patchRole(role, { maxWidthPercent })
                  }
                />
              </FieldOverride>
            </div>
          )
        })}
      </div>
      <div className="grid gap-3 rounded-xl border p-3">
        <p className="text-sm font-medium">Motion</p>
        <FieldOverride override={overrides?.[APPEARANCE_CONTROL_PATHS.motionEnabled]}>
          <label className="flex items-center justify-between gap-3 text-sm">
            Animation
            <Switch
              checked={motion.enabled ?? true}
              onCheckedChange={(enabled) => patchMotion({ enabled })}
              aria-label={`${idPrefix} motion enabled`}
            />
          </label>
        </FieldOverride>
        <FieldOverride override={overrides?.[APPEARANCE_CONTROL_PATHS.motionDuration]}>
          <RangeField
            label="Duration"
            ariaLabel={`${idPrefix} motion duration`}
            value={motion.durationMs ?? 220}
            min={0}
            max={2000}
            step={10}
            format={(amount) => `${amount} ms`}
            onChange={(durationMs) => patchMotion({ durationMs })}
          />
        </FieldOverride>
        <FieldOverride override={overrides?.[APPEARANCE_CONTROL_PATHS.motionReduced]}>
          <ChoiceField
            label="Reduced motion"
            ariaLabel={`${idPrefix} reduced motion`}
            value={motion.reducedMotion ?? "respect"}
            options={[
              { value: "respect", label: "Respect" },
              { value: "never", label: "Never" },
              { value: "always", label: "Always" },
            ]}
            onChange={(reducedMotion) => patchMotion({ reducedMotion })}
          />
        </FieldOverride>
        <FieldOverride override={overrides?.[APPEARANCE_CONTROL_PATHS.motionEase]}>
          <ChoiceField
            label="Easing"
            ariaLabel={`${idPrefix} motion easing`}
            value={easeName ?? "custom"}
            options={[
              ...NAMED_MOTION_EASES.map((name) => ({
                value: name,
                label: EASE_LABELS[name],
              })),
              ...(easeName == null && motion.ease !== undefined
                ? [{ value: "custom" as const, label: "Custom" }]
                : []),
            ]}
            onChange={(next) => {
              if (next !== "custom") patchMotion({ ease: next })
            }}
          />
        </FieldOverride>
      </div>
      <FieldOverride override={overrides?.[APPEARANCE_CONTROL_PATHS.captions]}>
        <label className="flex items-center justify-between gap-3 text-sm">
          Message action captions
          <Switch
            checked={values.messageActions?.captions ?? false}
            onCheckedChange={(captions) => patch({ messageActions: { captions } })}
            aria-label={`${idPrefix} message action captions`}
          />
        </label>
      </FieldOverride>
      <FieldOverride override={overrides?.[APPEARANCE_CONTROL_PATHS.showIds]}>
        <label className="flex items-center justify-between gap-3 text-sm">
          Show model ids
          <Switch
            checked={values.modelPicker?.showIds ?? false}
            onCheckedChange={(showIds) => patch({ modelPicker: { showIds } })}
            aria-label={`${idPrefix} show model ids`}
          />
        </label>
      </FieldOverride>
      <FieldOverride override={overrides?.[APPEARANCE_CONTROL_PATHS.radius]}>
        {customRadius ? (
          <div className="grid gap-1.5">
            <Label>Radius</Label>
            <Input
              aria-label={`${idPrefix} radius`}
              value={values.radius ?? ""}
              onChange={(event) => patch({ radius: event.target.value })}
            />
          </div>
        ) : (
          <RangeField
            label="Radius"
            ariaLabel={`${idPrefix} radius`}
            value={radiusAmount ?? 0.625}
            min={0}
            max={1.5}
            step={0.025}
            format={(amount) => `${amount}rem`}
            onChange={(amount) =>
              patch({ radius: `${Math.round(amount * 1000) / 1000}rem` })
            }
          />
        )}
      </FieldOverride>
    </div>
  )
}

export function mergeAppearanceControls(
  document: Appearance,
  next: AppearanceControlValues
): Appearance {
  return {
    ...document,
    scheme: next.scheme ?? document.scheme,
    density: next.density ?? document.density,
    radius: next.radius ?? document.radius,
    motion: { ...document.motion, ...next.motion },
    messageActions: {
      ...document.messageActions,
      ...next.messageActions,
    },
    messageLayout: {
      user: { ...document.messageLayout.user, ...next.messageLayout?.user },
      assistant: {
        ...document.messageLayout.assistant,
        ...next.messageLayout?.assistant,
      },
    },
    modelPicker: { ...document.modelPicker, ...next.modelPicker },
  }
}

/** Full theme documents always have these fields. */
export function appearanceControlValues(
  document: Appearance
): AppearanceControlValues {
  return {
    scheme: document.scheme,
    density: document.density,
    radius: document.radius,
    motion: document.motion,
    messageActions: document.messageActions,
    messageLayout: document.messageLayout,
    modelPicker: document.modelPicker,
  }
}
