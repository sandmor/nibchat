"use client"

import {
  isValidElement,
  memo,
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { Components } from "streamdown"
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockDownloadButton,
  Streamdown,
  StreamdownContext,
  TableCopyDropdown,
  TableDownloadDropdown,
  useIsCodeFenceIncomplete,
} from "streamdown"
import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, FullScreenIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { normalizeLatexDelimiters } from "@/lib/normalize-latex-delimiters"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
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

const FENCE_LANGUAGE = /language-([^\s]+)/
const FENCE_START_LINE = /startLine=(\d+)/

/** Single outline + topbar; Streamdown's nested card is stripped. */
const MARKDOWN_BLOCK_SHELL = "my-3 min-w-0 rounded-xl border"
const MARKDOWN_BLOCK_TOPBAR = "flex h-9 items-center gap-2 border-b px-2.5"
const MARKDOWN_BLOCK_LABEL =
  "min-w-0 flex-1 truncate font-mono text-xs lowercase text-muted-foreground"
const TABLE_ICON_BUTTON =
  "cursor-pointer p-1 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"

/** Strip Streamdown's nested card chrome; we supply a topbar instead. */
const FENCED_CODE_UNWRAP =
  "[&_[data-streamdown=code-block]]:contents [&_[data-streamdown=code-block-header]]:hidden [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-3 [&_[data-streamdown=code-block-body]]:[--sdm-bg:transparent] [&_[data-streamdown=code-block-body]]:[--shiki-dark-bg:transparent] [&_[data-streamdown=code-block-body]_pre]:bg-transparent"

function fenceSource(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children)
  }
  if (Array.isArray(children)) return children.map(fenceSource).join("")
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return fenceSource(children.props.children)
  }
  return ""
}

function fenceMeta(node: unknown): string | undefined {
  if (!node || typeof node !== "object" || !("properties" in node)) return
  const properties = node.properties
  if (!properties || typeof properties !== "object") return
  if (!("metastring" in properties)) return
  const meta = properties.metastring
  return typeof meta === "string" ? meta : undefined
}

function MarkdownCode({
  className,
  children,
  node,
  ...props
}: ComponentProps<"code"> & MarkdownNodeProps & { "data-block"?: unknown }) {
  const incomplete = useIsCodeFenceIncomplete()
  if (!("data-block" in props)) {
    return (
      <code
        className={cn(
          "rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
          className
        )}
        {...props}
      >
        {children}
      </code>
    )
  }

  const source = fenceSource(children)
  const language = className?.match(FENCE_LANGUAGE)?.[1] ?? ""
  const meta = fenceMeta(node)
  const startRaw = meta?.match(FENCE_START_LINE)?.[1]
  const startLine = startRaw ? Number.parseInt(startRaw, 10) : undefined
  const lineNumbers = !(meta && /\bnoLineNumbers\b/.test(meta))

  return (
    <div
      className={cn(
        MARKDOWN_BLOCK_SHELL,
        "overflow-hidden",
        FENCED_CODE_UNWRAP
      )}
      data-language={language || undefined}
    >
      <div className={MARKDOWN_BLOCK_TOPBAR}>
        <span className={MARKDOWN_BLOCK_LABEL}>{language || "code"}</span>
        <div className="flex shrink-0 items-center">
          <CodeBlockDownloadButton code={source} language={language} />
          <CodeBlockCopyButton code={source} />
        </div>
      </div>
      <CodeBlock
        code={source}
        isIncomplete={incomplete}
        language={language}
        lineNumbers={lineNumbers}
        startLine={startLine && startLine >= 1 ? startLine : undefined}
      />
    </div>
  )
}

const TableToolbar = memo(function TableToolbar({
  onExitFullscreen,
  onOpenFullscreen,
}: {
  onExitFullscreen?: () => void
  onOpenFullscreen?: () => void
}) {
  const { isAnimating } = useContext(StreamdownContext)

  return (
    <div className={MARKDOWN_BLOCK_TOPBAR}>
      <span className={MARKDOWN_BLOCK_LABEL}>table</span>
      <div className="flex shrink-0 items-center">
        <TableCopyDropdown />
        <TableDownloadDropdown />
        {onExitFullscreen ? (
          <button
            className={TABLE_ICON_BUTTON}
            onClick={onExitFullscreen}
            title="Exit fullscreen"
            type="button"
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              className="size-3.5"
              strokeWidth={2}
            />
          </button>
        ) : (
          <button
            className={TABLE_ICON_BUTTON}
            disabled={isAnimating}
            onClick={onOpenFullscreen}
            title="View fullscreen"
            type="button"
          >
            <HugeiconsIcon
              icon={FullScreenIcon}
              className="size-3.5"
              strokeWidth={2}
            />
          </button>
        )}
      </div>
    </div>
  )
})

const TABLE_DIALOG_CONTENT =
  "top-0 left-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 ring-0 sm:max-w-none duration-[var(--motion-effective-duration)] ease-[var(--motion-ease)] [animation-duration:var(--motion-effective-duration)]"

const TABLE_DIALOG_SCROLL =
  "min-h-0 flex-1 overflow-auto [&_[data-streamdown=table-header]]:sticky [&_[data-streamdown=table-header]]:top-0 [&_[data-streamdown=table-header]]:z-10"

/** One card with a topbar; thead is a full-bleed band, not a nested frame. */
const MarkdownTable = memo(function MarkdownTable({
  className,
  children,
  node: _node,
  ...props
}: ComponentProps<"table"> & MarkdownNodeProps) {
  void _node
  const { isAnimating } = useContext(StreamdownContext)
  const [fullscreen, setFullscreen] = useState(false)
  const [dialogMounted, setDialogMounted] = useState(false)

  if (isAnimating && fullscreen) {
    setFullscreen(false)
  }

  const dialogOpen = fullscreen && !isAnimating

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open && isAnimating) return
      if (open) setDialogMounted(true)
      setFullscreen(open)
    },
    [isAnimating]
  )
  const onOpenFullscreen = useCallback(() => onOpenChange(true), [onOpenChange])
  const onExitFullscreen = useCallback(
    () => onOpenChange(false),
    [onOpenChange]
  )

  const tableClassName = cn("w-full divide-y divide-border", className)

  return (
    <>
      <div
        className={MARKDOWN_BLOCK_SHELL}
        data-streamdown="table-wrapper"
        data-streaming={isAnimating ? "" : undefined}
      >
        <TableToolbar onOpenFullscreen={onOpenFullscreen} />
        <div className="min-w-0 overflow-x-auto rounded-b-xl">
          <table
            className={tableClassName}
            data-streamdown="table"
            {...props}
          >
            {children}
          </table>
        </div>
      </div>
      {dialogMounted && !isAnimating ? (
        <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
          <DialogContent
            showCloseButton={false}
            showOverlay={false}
            className={TABLE_DIALOG_CONTENT}
          >
            <DialogTitle className="sr-only">Table</DialogTitle>
            <div
              className="flex min-h-0 flex-1 flex-col"
              data-streamdown="table-wrapper"
            >
              <TableToolbar onExitFullscreen={onExitFullscreen} />
              <div className={TABLE_DIALOG_SCROLL}>
                <table className={tableClassName} data-streamdown="table">
                  {children}
                </table>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
})

const MarkdownThead = memo(function MarkdownThead({
  className,
  node: _node,
  ...props
}: ComponentProps<"thead"> & MarkdownNodeProps) {
  void _node
  return (
    <thead
      className={cn("bg-muted [&_th]:bg-muted", className)}
      data-streamdown="table-header"
      {...props}
    />
  )
})

const components: Components = {
  a: MarkdownLink,
  img: MarkdownImage,
  code: MarkdownCode,
  table: MarkdownTable,
  thead: MarkdownThead,
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
