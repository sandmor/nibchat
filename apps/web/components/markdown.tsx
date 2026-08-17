"use client"

import {
  type ComponentProps,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { Components } from "streamdown"
import { Streamdown } from "streamdown"
import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { cn } from "@/lib/utils"
import { normalizeLatexDelimiters } from "@/lib/normalize-latex-delimiters"
import "katex/dist/katex.min.css"
import "streamdown/styles.css"

const plugins = {
  code,
  // Single dollars are what models most often emit; authors can escape literal
  // currency signs as `\\$` when needed.
  math: createMathPlugin({ singleDollarTextMath: true }),
}

/** Temporary compatibility for models that emit standard LaTeX delimiters. */
const ENABLE_LATEX_DELIMITER_COMPATIBILITY = true

const MATH_OVERFLOW_HINT = "Scroll horizontally to view the full equation"

type MarkdownNodeProps = { node?: unknown }

function isExternalLink(href: string) {
  return /^https?:\/\//i.test(href)
}

function MarkdownLink({
  href,
  className,
  children,
  node: _node,
  ...props
}: ComponentProps<"a"> & MarkdownNodeProps) {
  void _node
  const external = Boolean(href && isExternalLink(href))

  return (
    <a
      {...props}
      href={href}
      className={cn(
        "font-medium wrap-anywhere text-primary underline underline-offset-2 hover:text-foreground",
        className
      )}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  )
}

function MarkdownImage({
  alt,
  className,
  node: _node,
  onError,
  ...props
}: ComponentProps<"img"> & MarkdownNodeProps) {
  void _node
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span className="my-3 inline-flex rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
        Image unavailable{alt ? `: ${alt}` : ""}
      </span>
    )
  }

  return (
    // Markdown images must remain plain elements so arbitrary remote URLs can
    // keep their no-referrer policy without requiring a Next image loader.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={alt ?? ""}
      className={cn("my-3 max-h-96 max-w-full rounded-lg", className)}
      decoding="async"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(event) => {
        setFailed(true)
        onError?.(event)
      }}
    />
  )
}

const components: Components = {
  a: MarkdownLink,
  img: MarkdownImage,
}

function setMathOverflow(el: HTMLElement, overflowing: boolean) {
  if (el.hasAttribute("data-math-overflow") === overflowing) return
  el.toggleAttribute("data-math-overflow", overflowing)
  if (overflowing) {
    el.tabIndex = 0
    el.title = MATH_OVERFLOW_HINT
  } else {
    el.removeAttribute("tabindex")
    el.removeAttribute("title")
  }
}

function inlineMathOverflows(el: HTMLElement, rootWidth: number) {
  // Read the current layout. Removing data-math-overflow to measure unconstrained
  // width would change height (scrollbars) and retrigger ResizeObserver.
  if (el.hasAttribute("data-math-overflow"))
    return el.scrollWidth > el.clientWidth + 1
  return el.getBoundingClientRect().width > rootWidth + 1
}

function useMathOverflow(
  rootRef: RefObject<HTMLDivElement | null>,
  content: string
) {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    let frame = 0
    let disposed = false
    const scheduleMeasure = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        if (disposed || root.clientWidth === 0) return

        for (const display of root.querySelectorAll<HTMLElement>(
          ".katex-display"
        )) {
          setMathOverflow(
            display,
            display.scrollWidth > display.clientWidth + 1
          )
        }

        for (const inline of root.querySelectorAll<HTMLElement>(".katex")) {
          if (inline.parentElement?.classList.contains("katex-display"))
            continue
          setMathOverflow(inline, inlineMathOverflows(inline, root.clientWidth))
        }
      })
    }

    scheduleMeasure()
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(root)
    document.fonts?.ready.then(scheduleMeasure)

    return () => {
      disposed = true
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [content, rootRef])
}

/** Visible message markdown with code, GFM, and KaTeX support. */
export function Markdown({
  children,
  className,
  streaming = false,
  variant = "message",
}: {
  children: string
  className?: string
  streaming?: boolean
  variant?: "message" | "reasoning"
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const content = ENABLE_LATEX_DELIMITER_COMPATIBILITY
    ? normalizeLatexDelimiters(children, streaming)
    : children
  useMathOverflow(rootRef, content)

  return (
    <div
      ref={rootRef}
      className={cn(
        "markdown-content max-w-full min-w-0",
        variant === "reasoning" && "markdown-content-reasoning",
        className
      )}
    >
      <Streamdown
        className="min-w-0"
        components={components}
        isAnimating={streaming}
        linkSafety={{ enabled: false }}
        mode={streaming ? "streaming" : "static"}
        plugins={plugins}
      >
        {content}
      </Streamdown>
    </div>
  )
}
