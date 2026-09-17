import type { Part, Parts } from "@/lib/types"

export function isActivityPart(part: Part) {
  return (
    part.type === "reasoning" ||
    (part.type === "tool-invocation" &&
      part.toolName !== "question" &&
      part.state !== "output-error")
  )
}

/** Keep the first part's index as the key as a streaming group grows. */
export function groupMessageActivity(parts: Parts) {
  const groups: { index: number; activity: boolean; parts: Parts }[] = []
  parts.forEach((part, index) => {
    const activity = isActivityPart(part)
    const previous = groups.at(-1)
    if (activity && previous?.activity) previous.parts.push(part)
    else groups.push({ index, activity, parts: [part] })
  })
  return groups
}

export function activitySummary(parts: Parts) {
  const tools = new Map<string, number>()
  let reasoning = false
  for (const part of parts) {
    if (part.type === "reasoning") reasoning = true
    if (part.type === "tool-invocation") {
      const name = part.toolName.replaceAll("_", " ")
      tools.set(name, (tools.get(name) ?? 0) + 1)
    }
  }
  return [
    ...(reasoning ? ["Reasoning"] : []),
    ...Array.from(tools, ([name, count]) =>
      count > 1 ? `${name} × ${count}` : name
    ),
  ].join(" · ")
}

export function isActivityGroupBusy(parts: Parts) {
  return parts.some(
    (part) =>
      part.type === "tool-invocation" &&
      (part.state === "input-streaming" || part.state === "input-available")
  )
}

/**
 * Fold idle activity once the answer (or the stream) has moved on.
 * A summary click is sticky. Live-edge only gates mid-stream collapse;
 * stream-end cleanup always folds unless the reader pinned the block.
 */
export function shouldAutoCollapseActivity(input: {
  streaming: boolean
  busy: boolean
  hasSuccessor: boolean
  userToggled: boolean
  atLiveEdge: boolean
}) {
  if (input.userToggled || input.busy) return false
  if (!input.streaming) return true
  return input.hasSuccessor && input.atLiveEdge
}
