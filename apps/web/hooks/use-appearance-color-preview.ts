"use client"

import { useState } from "react"
import { usePreviewTransaction } from "@/hooks/use-preview-transaction"
import {
  cssColorToOklch,
  formatOklch,
  type OklchColor,
} from "@/lib/appearance-color"

export function useAppearanceColorPreview({
  source,
  publish,
  commit,
  discard,
  commitDelayMs,
}: {
  source: string
  publish: (value: string) => void
  commit: () => void
  discard: () => void
  commitDelayMs?: number
}) {
  const [state, setState] = useState(() => ({
    source,
    color: cssColorToOklch(source),
  }))
  if (state.source !== source) {
    setState({ source, color: cssColorToOklch(source) })
  }

  const transaction = usePreviewTransaction<OklchColor>({
    publish: (color) => publish(formatOklch(color)),
    commit,
    discard,
    commitDelayMs,
  })

  return {
    color: state.color,
    change(color: OklchColor) {
      setState({ source, color })
      transaction.schedule(color)
    },
    commit: transaction.commit,
    discard: transaction.discard,
  }
}
