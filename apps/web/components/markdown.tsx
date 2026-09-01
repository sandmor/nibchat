"use client"

import {
  isValidElement,
  memo,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { createPortal } from "react-dom"
import type { Components } from "streamdown"
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockDownloadButton,
  Streamdown,
  StreamdownContext,
  TableCopyDropdown,
  TableDownloadDropdown,
  extractTableDataFromElement,
  tableDataToCSV,
  tableDataToMarkdown,
  tableDataToTSV,
  useIsCodeFenceIncomplete,
} from "streamdown"
import { code } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, FullScreenIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { normalizeLatexDelimiters } from "@/lib/normalize-latex-delimiters"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { copyText } from "@/lib/clipboard"
import {
  MARKDOWN_ACTION,
  MARKDOWN_BLOCK_LABEL,
  MARKDOWN_BLOCK_SHELL,
  MARKDOWN_BLOCK_TOPBAR,
  codeFilename,
  isExternalMarkdownLink,
  parseCodeFence,
} from "@/lib/markdown-blocks"
import { prepareStaticMarkdown } from "@/lib/static-markdown"
import {
  hideMarkdownTooltips,
  retainMarkdownTooltips,
} from "@/lib/markdown-tooltips"
import { toast } from "sonner"
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

function MarkdownLink({
  href,
  className,
  children,
  node: _node,
  ...props
}: ComponentProps<"a"> & MarkdownNodeProps) {
  void _node
  const external = Boolean(href && isExternalMarkdownLink(href))

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
  const language = className?.match(/language-([^\s]+)/)?.[1] ?? ""
  const meta = fenceMeta(node)
  const fence = parseCodeFence([language, meta].filter(Boolean).join(" "))

  return (
    <div
      className={cn(
        MARKDOWN_BLOCK_SHELL,
        "overflow-hidden",
        FENCED_CODE_UNWRAP
      )}
      data-language={fence.language || undefined}
      data-markdown-code-block=""
    >
      <div className={MARKDOWN_BLOCK_TOPBAR}>
        <span className={MARKDOWN_BLOCK_LABEL}>{fence.language || "code"}</span>
        <div className="flex shrink-0 items-center">
          <CodeBlockDownloadButton code={source} language={fence.language} />
          <CodeBlockCopyButton code={source} />
        </div>
      </div>
      <CodeBlock
        code={source}
        isIncomplete={incomplete}
        language={fence.language}
        lineNumbers={fence.lineNumbers}
        startLine={fence.startLine}
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
          <table className={tableClassName} data-streamdown="table" {...props}>
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

const COPY_MENU_ITEMS = [
  { format: "markdown", label: "Markdown", title: "Copy table as Markdown" },
  { format: "csv", label: "CSV", title: "Copy table as CSV" },
  { format: "tsv", label: "TSV", title: "Copy table as TSV" },
] as const

const DOWNLOAD_MENU_ITEMS = [
  { format: "csv", label: "CSV", title: "Download table as CSV" },
  { format: "markdown", label: "Markdown", title: "Download table as Markdown" },
] as const

type TableMenuKind = "copy" | "download"

type TableMenuState = {
  kind: TableMenuKind
  table: HTMLElement
  trigger: HTMLElement
}

function MarkdownTableMenu({
  open,
  menu,
  onAction,
  onClose,
}: {
  open: boolean
  menu: TableMenuState | null
  onAction: (event: MouseEvent<HTMLDivElement>) => void
  onClose: () => void
}) {
  const popupRef = useRef<HTMLDivElement>(null)
  const [keepMounted, setKeepMounted] = useState(false)

  if (open && !keepMounted) setKeepMounted(true)

  const state = open ? "open" : "closed"

  useLayoutEffect(() => {
    const popup = popupRef.current
    const trigger = menu?.trigger
    if (!keepMounted || !open || !popup || !trigger?.isConnected) return

    const position = () => {
      const rect = trigger.getBoundingClientRect()
      const width = popup.offsetWidth
      const left = Math.min(
        Math.max(8, rect.right - width),
        Math.max(8, window.innerWidth - width - 8)
      )
      popup.style.left = `${left}px`
      popup.style.top = `${rect.bottom + 4}px`
    }

    position()
    window.addEventListener("resize", position)
    document.addEventListener("scroll", position, true)
    return () => {
      window.removeEventListener("resize", position)
      document.removeEventListener("scroll", position, true)
    }
  }, [keepMounted, open, menu])

  useEffect(() => {
    if (!open || !menu) return
    menu.trigger.setAttribute("aria-expanded", "true")
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath()
      if (popupRef.current && path.includes(popupRef.current)) return
      if (path.includes(menu.trigger)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      menu.trigger.removeAttribute("aria-expanded")
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open, menu, onClose])

  useEffect(() => {
    if (open || !keepMounted) return
    const timeout = window.setTimeout(() => setKeepMounted(false), 400)
    return () => window.clearTimeout(timeout)
  }, [open, keepMounted])

  if (!keepMounted || !menu) return null

  const items = menu.kind === "copy" ? COPY_MENU_ITEMS : DOWNLOAD_MENU_ITEMS
  const action =
    menu.kind === "copy"
      ? MARKDOWN_ACTION.copyTable
      : MARKDOWN_ACTION.downloadTable

  return createPortal(
    <div
      ref={popupRef}
      data-markdown-menu-popup=""
      data-state={state}
      data-theme-group="popover"
      data-theme-target="popover"
      role="menu"
      onClick={(event) => {
        event.stopPropagation()
        onAction(event)
      }}
      onAnimationEnd={(event) => {
        if (
          event.target !== event.currentTarget ||
          event.animationName !== "markdown-menu-out" ||
          open
        ) {
          return
        }
        setKeepMounted(false)
      }}
    >
      {items.map((item) => (
        <button
          key={item.format}
          type="button"
          role="menuitem"
          title={item.title}
          data-markdown-action={action}
          data-markdown-format={item.format}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function codeBlockText(block: HTMLElement) {
  const lines = block.querySelectorAll<HTMLElement>("[data-markdown-code-line]")
  if (lines.length > 0)
    return [...lines].map((line) => line.textContent ?? "").join("\n")
  return block.querySelector("code")?.textContent ?? ""
}

function useMarkdownActions() {
  const [fullscreenTable, setFullscreenTable] = useState<string | null>(null)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [tableMenu, setTableMenu] = useState<TableMenuState | null>(null)
  const [tableMenuOpen, setTableMenuOpen] = useState(false)
  const tableMenuRef = useRef<TableMenuState | null>(null)
  tableMenuRef.current = tableMenu

  const closeTableMenu = useCallback(() => setTableMenuOpen(false), [])
  const onFullscreenOpenChange = useCallback((open: boolean) => {
    if (!open) hideMarkdownTooltips()
    setFullscreenOpen(open)
  }, [])

  const onClick = useCallback(async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const actionElement = target.closest<HTMLElement>("[data-markdown-action]")
    const action = actionElement?.dataset.markdownAction
    if (!action || !actionElement) return
    event.preventDefault()

    const codeBlock = actionElement.closest<HTMLElement>(
      "[data-markdown-code-block]"
    )
    const tableBlock = actionElement.closest<HTMLElement>(
      "[data-markdown-table]"
    )
    const tableFromMenu = tableMenuRef.current?.table
    const table =
      tableBlock?.querySelector<HTMLElement>("table") ??
      (actionElement.closest("[data-markdown-menu-popup]")
        ? tableFromMenu
        : null)

    try {
      if (action === MARKDOWN_ACTION.copyCode && codeBlock) {
        await copyText(codeBlockText(codeBlock))
        actionElement.dataset.copied = ""
        window.setTimeout(() => delete actionElement.dataset.copied, 2_000)
        toast.success("Code copied")
        return
      }
      if (action === MARKDOWN_ACTION.downloadCode && codeBlock) {
        const language =
          codeBlock.querySelector<HTMLElement>("[data-markdown-language]")
            ?.dataset.markdownLanguage ?? ""
        downloadText(
          codeFilename(language),
          codeBlockText(codeBlock),
          "text/plain"
        )
        toast.success("Code downloaded")
        return
      }
      if (!table) return

      const openMenu = (kind: TableMenuKind) => {
        hideMarkdownTooltips()
        const current = tableMenuRef.current
        if (
          tableMenuOpen &&
          current?.kind === kind &&
          current.trigger === actionElement
        ) {
          setTableMenuOpen(false)
          return
        }
        if (
          current?.kind !== kind ||
          current.trigger !== actionElement ||
          current.table !== table
        ) {
          setTableMenu({ kind, table, trigger: actionElement })
        }
        setTableMenuOpen(true)
      }

      if (action === MARKDOWN_ACTION.openCopyMenu) {
        openMenu("copy")
        return
      }
      if (action === MARKDOWN_ACTION.openDownloadMenu) {
        openMenu("download")
        return
      }
      if (action === MARKDOWN_ACTION.fullscreenTable) {
        hideMarkdownTooltips()
        setTableMenuOpen(false)
        setFullscreenTable(table.outerHTML)
        setFullscreenOpen(true)
        return
      }

      const data = extractTableDataFromElement(table)
      const format = actionElement.dataset.markdownFormat
      const text =
        format === "markdown"
          ? tableDataToMarkdown(data)
          : format === "tsv"
            ? tableDataToTSV(data)
            : tableDataToCSV(data)
      if (action === MARKDOWN_ACTION.copyTable) {
        await copyText(text)
        setTableMenuOpen(false)
        toast.success("Table copied")
        return
      }
      if (action === MARKDOWN_ACTION.downloadTable) {
        const markdown = format === "markdown"
        downloadText(
          `table.${markdown ? "md" : "csv"}`,
          text,
          markdown ? "text/markdown" : "text/csv"
        )
        setTableMenuOpen(false)
        toast.success("Table downloaded")
      }
    } catch {
      toast.error("Could not complete Markdown action")
    }
  }, [tableMenuOpen])

  const onErrorCapture = useCallback(
    (event: SyntheticEvent<HTMLDivElement>) => {
      const target = event.target
      if (!(target instanceof HTMLImageElement)) return
      const wrapper = target.closest<HTMLElement>(
        "[data-markdown-image-wrapper]"
      )
      const fallback = wrapper?.querySelector<HTMLElement>(
        "[data-markdown-image-fallback]"
      )
      target.classList.add("hidden")
      fallback?.classList.remove("hidden")
    },
    []
  )

  return {
    closeTableMenu,
    fullscreenOpen,
    fullscreenTable,
    onClick,
    onErrorCapture,
    onFullscreenOpenChange,
    tableMenu,
    tableMenuOpen,
  }
}

function StaticMarkdownBody({ source }: { source: string }) {
  useEffect(() => retainMarkdownTooltips(), [])
  const entry = prepareStaticMarkdown(source)
  const html = useSyncExternalStore(
    entry.subscribe,
    entry.getSnapshot,
    entry.getServerSnapshot
  )
  useEffect(() => {
    hideMarkdownTooltips()
  }, [html.__html])
  return (
    <div className="markdown-static min-w-0" dangerouslySetInnerHTML={html} />
  )
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
  const markdownActions = useMarkdownActions()

  return (
    <div
      ref={rootRef}
      data-markdown-renderer={streaming ? "streamdown" : "marked"}
      onClick={markdownActions.onClick}
      onErrorCapture={markdownActions.onErrorCapture}
      className={cn(
        "markdown-content max-w-full min-w-0",
        variant === "reasoning" && "markdown-content-reasoning",
        className
      )}
    >
      {streaming ? (
        <Streamdown
          className="min-w-0"
          components={components}
          isAnimating
          linkSafety={{ enabled: false }}
          mode="streaming"
          plugins={plugins}
        >
          {content}
        </Streamdown>
      ) : (
        <>
          <StaticMarkdownBody source={content} />
          <MarkdownTableMenu
            open={markdownActions.tableMenuOpen}
            menu={markdownActions.tableMenu}
            onAction={markdownActions.onClick}
            onClose={markdownActions.closeTableMenu}
          />
          <Dialog
            open={markdownActions.fullscreenOpen}
            onOpenChange={markdownActions.onFullscreenOpenChange}
          >
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
                <TableToolbar
                  onExitFullscreen={() =>
                    markdownActions.onFullscreenOpenChange(false)
                  }
                />
                <div
                  className={TABLE_DIALOG_SCROLL}
                  dangerouslySetInnerHTML={{
                    __html: markdownActions.fullscreenTable ?? "",
                  }}
                />
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
