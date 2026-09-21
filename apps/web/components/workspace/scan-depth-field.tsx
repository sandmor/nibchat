"use client"

import { useId } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PRODUCT_DEFAULTS } from "@/lib/chat-settings"
import { MAX_SCAN_DEPTH } from "@/lib/limits"

export function ScanDepthField({
  value,
  onChange,
  inherit = false,
  disabled = false,
  compact = false,
}: {
  value: number | null | undefined
  onChange: (value: number | null | undefined) => void
  inherit?: boolean
  disabled?: boolean
  compact?: boolean
}) {
  const id = useId()
  const depth =
    value === undefined && !inherit
      ? PRODUCT_DEFAULTS.contextScanDepth
      : value
  const mode =
    depth === undefined ? "inherit" : depth === null ? "branch" : "recent"
  const items = {
    ...(inherit ? { inherit: "Use chat setting" } : {}),
    recent: "Recent messages",
    branch: "Entire branch",
  }
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Scan depth</Label>
      <Select
        value={mode}
        disabled={disabled}
        items={items}
        onValueChange={(next) => {
          if (next === "inherit") onChange(undefined)
          if (next === "branch") onChange(null)
          if (next === "recent")
            onChange(
              typeof depth === "number"
                ? depth
                : PRODUCT_DEFAULTS.contextScanDepth
            )
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {inherit ? (
            <SelectItem value="inherit">Use chat setting</SelectItem>
          ) : null}
          <SelectItem value="recent">Recent messages</SelectItem>
          <SelectItem value="branch">Entire branch</SelectItem>
        </SelectContent>
      </Select>
      {mode === "recent" ? (
        <Input
          key={depth}
          type="number"
          min={1}
          max={MAX_SCAN_DEPTH}
          step={1}
          aria-label="Number of recent messages"
          disabled={disabled}
          defaultValue={depth ?? PRODUCT_DEFAULTS.contextScanDepth}
          onBlur={(event) => {
            const next = Number(event.target.value)
            if (Number.isInteger(next) && next >= 1 && next <= MAX_SCAN_DEPTH)
              onChange(next)
            else event.target.value = String(depth)
          }}
        />
      ) : null}
      {compact ? (
        <p className="text-xs text-muted-foreground">
          {inherit
            ? "Unset follows the chat."
            : "Messages searched for context-book keywords."}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {inherit
            ? "Unset follows the chat. Overrides apply to this entry only."
            : "How many recent user and assistant messages to search. Entries can override this."}
        </p>
      )}
    </div>
  )
}
