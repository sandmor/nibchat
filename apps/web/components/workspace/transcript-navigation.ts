export type TranscriptElementNavigation = {
  target: HTMLElement
  align: "start" | "end" | "nearest"
  behavior: ScrollBehavior
  bounds?: { top: number; bottom: number }
}

type Navigate = (request: TranscriptElementNavigation) => void
type TranscriptNavigator = {
  navigate: Navigate
  prepareChat: (chatKey: string) => void
}
const navigators = new WeakMap<HTMLElement, TranscriptNavigator>()

export function registerTranscriptNavigation(
  port: HTMLElement,
  navigator: TranscriptNavigator
) {
  navigators.set(port, navigator)
  return () => {
    navigators.delete(port)
  }
}

export function transcriptScrollport(
  target: HTMLElement
): HTMLElement | undefined {
  for (let port = target.parentElement; port; port = port.parentElement)
    if (navigators.has(port)) return port
}

/** DOM targets also serve find's outer layer, which lives above the transcript. */
export function navigateTranscriptElement(
  target: HTMLElement,
  align: TranscriptElementNavigation["align"],
  behavior: ScrollBehavior = "auto",
  bounds?: TranscriptElementNavigation["bounds"]
): boolean {
  const port = transcriptScrollport(target)
  if (!port) return false
  navigators.get(port)!.navigate({ target, align, behavior, bounds })
  return true
}

/** Capture the draft reader before persisting it changes message and chat IDs. */
export function prepareTranscriptCreation(
  pane: HTMLElement | null,
  chatKey: string
) {
  const port = pane?.querySelector<HTMLElement>("[data-transcript-viewport]")
  if (port) navigators.get(port)!.prepareChat(chatKey)
}
