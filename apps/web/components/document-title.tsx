"use client"

import { useEffect } from "react"
import { browserDocumentTitle } from "@/lib/page-title"

/** Keep `document.title` in sync for client-side title changes (rename, auto-title). */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = browserDocumentTitle(title)
  }, [title])
  return null
}
