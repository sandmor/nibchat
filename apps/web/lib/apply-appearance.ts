import { compileAppearance, type Appearance } from "@/lib/appearance"

const REMOTE_LINK_ID = "nibchat-remote-appearance"

export type AppearanceApplier = {
  apply: (doc: Appearance) => void
  applyVariable: (name: `--${string}`, value: string) => void
  dispose: () => void
}

/** Diffing root applier. It owns only properties compiled by appearance.ts. */
export function createAppearanceApplier(
  root: HTMLElement = document.documentElement
): AppearanceApplier {
  let previousVars: Record<string, string> = {}
  let previousRemote: string | undefined

  function syncRemote(url: string | undefined) {
    if (url === previousRemote) return
    previousRemote = url
    let link = document.getElementById(REMOTE_LINK_ID) as HTMLLinkElement | null
    if (!url) {
      link?.remove()
      return
    }
    if (!link) {
      link = document.createElement("link")
      link.id = REMOTE_LINK_ID
      link.rel = "stylesheet"
      document.head.appendChild(link)
    }
    link.href = url
  }

  return {
    apply(doc) {
      const vars = compileAppearance(doc)
      for (const key of Object.keys(previousVars)) {
        if (!(key in vars)) root.style.removeProperty(key)
      }
      for (const [key, value] of Object.entries(vars)) {
        if (previousVars[key] !== value) root.style.setProperty(key, value)
      }
      previousVars = vars
      root.dataset.density = doc.density
      root.dataset.motionEnabled = String(doc.motion.enabled)
      root.dataset.motionReduced = doc.motion.reducedMotion
      root.classList.toggle("dark", doc.scheme === "dark")
      root.style.colorScheme = doc.scheme
      syncRemote(doc.remoteStylesheet)
    },
    applyVariable(name, value) {
      if (previousVars[name] === value) return
      root.style.setProperty(name, value)
      previousVars[name] = value
    },
    dispose() {
      for (const key of Object.keys(previousVars))
        root.style.removeProperty(key)
      previousVars = {}
      previousRemote = undefined
      document.getElementById(REMOTE_LINK_ID)?.remove()
      delete root.dataset.density
      delete root.dataset.motionEnabled
      delete root.dataset.motionReduced
      root.classList.remove("dark")
      root.style.removeProperty("color-scheme")
    },
  }
}
