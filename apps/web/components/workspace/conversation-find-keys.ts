export type FindKeyAction = "open" | "close" | "next" | "prev" | "use-path"

export type FindKeyInput = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

export type FindKeyContext = {
  findOpen: boolean
  pendingPathSwitch: boolean
  renameOpen: boolean
  view: "linear" | "tree"
  canUseThisPath: boolean
  inPane: boolean
  inFindInput: boolean
  inDialog: boolean
}

export function conversationFindKeyAction(
  event: FindKeyInput,
  ctx: FindKeyContext
): FindKeyAction | null {
  const meta = event.metaKey || event.ctrlKey
  const letter = event.key.length === 1 ? event.key.toLowerCase() : event.key

  if (meta && letter === "f" && !event.shiftKey) {
    if (!ctx.inPane && !ctx.findOpen) return null
    return "open"
  }

  if (!ctx.findOpen) return null

  if (event.key === "Escape") {
    if (ctx.pendingPathSwitch || ctx.renameOpen || ctx.inDialog) return null
    return "close"
  }

  if (ctx.pendingPathSwitch) return null

  if (
    meta &&
    event.key === "Enter" &&
    ctx.view === "tree" &&
    ctx.canUseThisPath
  ) {
    return "use-path"
  }

  const nextKey =
    (event.key === "F3" && !event.shiftKey) ||
    (meta && letter === "g" && !event.shiftKey) ||
    (event.key === "Enter" && !event.shiftKey && ctx.inFindInput)
  const prevKey =
    (event.key === "F3" && event.shiftKey) ||
    (meta && letter === "g" && event.shiftKey) ||
    (event.key === "Enter" && event.shiftKey && ctx.inFindInput)

  if (nextKey) return "next"
  if (prevKey) return "prev"
  return null
}
