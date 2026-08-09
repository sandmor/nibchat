import type { Appearance } from "@/lib/appearance"

const REMOTE_LINK_ID = "nibchat-remote-appearance"

/** Apply appearance.vars + density to document.documentElement. */
export function applyAppearanceVars(doc: Appearance): () => void {
  const root = document.documentElement
  const applied = Object.keys(doc.vars)
  for (const [key, value] of Object.entries(doc.vars)) {
    root.style.setProperty(key, value)
  }
  root.dataset.density = doc.density
  return () => {
    for (const key of applied) root.style.removeProperty(key)
    delete root.dataset.density
  }
}

/** Sync optional remote stylesheet link from appearance.remoteStylesheet. */
export function applyRemoteStylesheet(url: string | undefined): void {
  if (!url) {
    document.getElementById(REMOTE_LINK_ID)?.remove()
    return
  }
  let link = document.getElementById(REMOTE_LINK_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement("link")
    link.id = REMOTE_LINK_ID
    link.rel = "stylesheet"
    document.head.appendChild(link)
  }
  link.href = url
}

export function removeRemoteStylesheet(): void {
  document.getElementById(REMOTE_LINK_ID)?.remove()
}
