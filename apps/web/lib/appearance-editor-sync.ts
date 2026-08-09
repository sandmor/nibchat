/**
 * Settings CodeMirror buffer reconciliation against appearance store draft SOT.
 */

import {
  appearanceToJson,
  parseAppearance,
  type Appearance,
} from "@/lib/appearance"

/**
 * Keep user formatting when `prev` already encodes the same draft.
 * Replace with pretty-printed draft when invalid or draft diverged (magic, preset, save).
 */
export function reconcileEditorText(
  prev: string,
  draft: Appearance
): { text: string; replaced: boolean } {
  try {
    if (
      appearanceToJson(parseAppearance(JSON.parse(prev)), false) ===
      appearanceToJson(draft, false)
    ) {
      return { text: prev, replaced: false }
    }
  } catch {
    /* invalid buffer — store SOT wins */
  }
  return { text: appearanceToJson(draft), replaced: true }
}
