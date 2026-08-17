function isEscaped(source: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor--)
    slashCount++
  return slashCount % 2 === 1
}

function closingBacktick(source: string, index: number, length: number) {
  const marker = "`".repeat(length)
  return source.indexOf(marker, index + length)
}

function closingLatexDelimiter(
  source: string,
  index: number,
  closing: ")" | "]"
) {
  for (let cursor = index; cursor < source.length; cursor++) {
    if (source[cursor] === "`") {
      let length = 1
      while (source[cursor + length] === "`") length++
      const close = closingBacktick(source, cursor, length)
      if (close === -1) return -1
      cursor = close + length - 1
      continue
    }
    if (
      source[cursor] === "\\" &&
      source[cursor + 1] === closing &&
      !isEscaped(source, cursor)
    )
      return cursor
  }
  return -1
}

function skipSpaces(source: string, index: number) {
  while (
    index < source.length &&
    (source[index] === " " || source[index] === "\t")
  )
    index++
  return index
}

/**
 * Index just after a markdown link/image destination that starts at `destStart`
 * (first character after `](` and optional spaces). Returns `destStart` when
 * the destination is not a well-formed `(...)` / `<...>` span.
 */
function endOfLinkDestination(source: string, destStart: number): number {
  if (destStart >= source.length) return destStart
  if (source[destStart] === "<") {
    for (let cursor = destStart + 1; cursor < source.length; cursor++) {
      if (source[cursor] === "\n") return destStart
      if (source[cursor] === ">" && !isEscaped(source, cursor)) {
        const afterTitle = skipLinkTitle(source, skipSpaces(source, cursor + 1))
        return afterTitle < source.length && source[afterTitle] === ")"
          ? afterTitle + 1
          : destStart
      }
    }
    return destStart
  }
  let depth = 1
  for (let cursor = destStart; cursor < source.length; cursor++) {
    if (source[cursor] === "\n") return destStart
    if (source[cursor] === "(" && !isEscaped(source, cursor)) depth++
    else if (source[cursor] === ")" && !isEscaped(source, cursor)) {
      depth--
      if (depth === 0) return cursor + 1
    }
  }
  return destStart
}

function skipLinkTitle(source: string, index: number) {
  const opener = source[index]
  if (opener !== '"' && opener !== "'" && opener !== "(") return index
  const closer = opener === "(" ? ")" : opener
  for (let cursor = index + 1; cursor < source.length; cursor++) {
    if (source[cursor] === "\n") return index
    if (source[cursor] === closer && !isEscaped(source, cursor))
      return skipSpaces(source, cursor + 1)
  }
  return index
}

function endOfAutolink(source: string, index: number) {
  if (source[index] !== "<") return index
  const rest = source.slice(index + 1, index + 8).toLowerCase()
  if (
    !rest.startsWith("http:") &&
    !rest.startsWith("https:") &&
    !rest.startsWith("mailto:")
  )
    return index
  const close = source.indexOf(">", index + 1)
  if (close === -1 || source.slice(index, close).includes("\n")) return index
  return close + 1
}

/**
 * Streamdown's math plugin deliberately accepts dollar delimiters only. Models
 * also commonly emit LaTeX's \(...\) and \[...\] forms, so normalize those
 * forms before parsing while preserving code examples, link destinations, and
 * escaped text.
 */
export function normalizeLatexDelimiters(source: string, streaming: boolean) {
  let output = ""
  let index = 0
  let fence: { marker: "`" | "~"; length: number } | null = null

  while (index < source.length) {
    const lineStart = index === 0 || source[index - 1] === "\n"
    if (lineStart) {
      const lineEnd = source.indexOf("\n", index)
      const end = lineEnd === -1 ? source.length : lineEnd
      const line = source.slice(index, end)
      const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
      if (fence) {
        output += source.slice(index, end)
        if (
          match &&
          match[1]![0] === fence.marker &&
          match[1]!.length >= fence.length &&
          /^[ \t]*$/.test(line.slice(match[0].length))
        )
          fence = null
        if (lineEnd !== -1) output += "\n"
        index = lineEnd === -1 ? source.length : lineEnd + 1
        continue
      }
      if (match) {
        fence = {
          marker: match[1]![0] as "`" | "~",
          length: match[1]!.length,
        }
        output += source.slice(index, end)
        if (lineEnd !== -1) output += "\n"
        index = lineEnd === -1 ? source.length : lineEnd + 1
        continue
      }
    }

    if (source[index] === "`") {
      let length = 1
      while (source[index + length] === "`") length++
      const close = closingBacktick(source, index, length)
      if (close === -1) {
        output += source.slice(index)
        break
      }
      output += source.slice(index, close + length)
      index = close + length
      continue
    }

    if (
      source[index] === "]" &&
      source[index + 1] === "(" &&
      !isEscaped(source, index)
    ) {
      const destStart = skipSpaces(source, index + 2)
      const destEnd = endOfLinkDestination(source, destStart)
      if (destEnd > destStart) {
        output += source.slice(index, destEnd)
        index = destEnd
        continue
      }
    }

    const autolinkEnd = endOfAutolink(source, index)
    if (autolinkEnd > index) {
      output += source.slice(index, autolinkEnd)
      index = autolinkEnd
      continue
    }

    if (
      source[index] === "\\" &&
      !isEscaped(source, index) &&
      (source[index + 1] === "(" || source[index + 1] === "[")
    ) {
      const opening = source[index + 1]
      const closing = opening === "(" ? ")" : "]"
      const close = closingLatexDelimiter(source, index + 2, closing)
      if (close !== -1) {
        const expression = source.slice(index + 2, close)
        if (opening === "(") output += `$${expression}$`
        else output += `\n\n$$\n${expression.trim()}\n$$\n\n`
        index = close + 2
        continue
      }
      // Streamdown can repair an unfinished display block but not an unfinished
      // inline dollar expression. Close the temporary expression locally; the
      // next streamed update replaces it with the real closing delimiter.
      if (streaming) {
        const expression = source.slice(index + 2)
        if (opening === "(") output += `$${expression}$`
        else output += `\n\n$$\n${expression.trim()}\n$$\n`
        break
      }
    }

    output += source[index]
    index++
  }

  return output
}
