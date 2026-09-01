export const MARKDOWN_ACTION = {
  copyCode: "copy-code",
  downloadCode: "download-code",
  copyTable: "copy-table",
  downloadTable: "download-table",
  openCopyMenu: "open-copy-menu",
  openDownloadMenu: "open-download-menu",
  fullscreenTable: "fullscreen-table",
} as const

export type MarkdownAction =
  (typeof MARKDOWN_ACTION)[keyof typeof MARKDOWN_ACTION]

export const MARKDOWN_BLOCK_SHELL = "my-3 min-w-0 rounded-xl border"
export const MARKDOWN_BLOCK_TOPBAR =
  "flex h-9 items-center gap-2 border-b px-2.5"
export const MARKDOWN_BLOCK_LABEL =
  "min-w-0 flex-1 truncate font-mono text-xs lowercase text-muted-foreground"

const MARKDOWN_ICON_BUTTON =
  "cursor-pointer p-1 text-muted-foreground transition-all hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"

// `/* HTML */` enables embedded HTML tooling while keeping these plain strings.
const COPY_ICON = /* HTML */ `<svg
  aria-hidden="true"
  fill="currentColor"
  height="14"
  viewBox="0 0 16 16"
  width="14"
>
  <path
    fill-rule="evenodd"
    d="M2.75.5A1.75 1.75 0 0 0 1 2.25v7.5c0 .967.783 1.75 1.75 1.75H4.5V10H2.75a.25.25 0 0 1-.25-.25v-7.5c0-.138.112-.25.25-.25h5.5a.25.25 0 0 1 .25.25V3H10V2.25A1.75 1.75 0 0 0 8.25.5h-5.5ZM7.75 4.5A1.75 1.75 0 0 0 6 6.25v7.5c0 .967.783 1.75 1.75 1.75h5.5c.967 0 1.75-.783 1.75-1.75v-7.5A1.75 1.75 0 0 0 13.25 4.5h-5.5Zm-.25 1.75c0-.138.112-.25.25-.25h5.5c.138 0 .25.112.25.25v7.5a.25.25 0 0 1-.25.25h-5.5a.25.25 0 0 1-.25-.25v-7.5Z"
    clip-rule="evenodd"
  />
</svg>`
const DOWNLOAD_ICON = /* HTML */ `<svg
  aria-hidden="true"
  fill="currentColor"
  height="14"
  viewBox="0 0 16 16"
  width="14"
>
  <path
    d="M8.75 1v7.689l1.97-1.97 1.06 1.06-3.073 3.074a1 1 0 0 1-1.414 0L4.22 7.78l1.06-1.06 1.97 1.97V1h1.5ZM13.5 9.25v4.25h-11V9.25H1V14c0 .552.448 1 1 1h12c.552 0 1-.448 1-1V9.25h-1.5Z"
  />
</svg>`
const FULLSCREEN_ICON = /* HTML */ `<svg
  aria-hidden="true"
  fill="currentColor"
  height="14"
  viewBox="0 0 16 16"
  width="14"
>
  <path
    fill-rule="evenodd"
    d="M1 2a1 1 0 0 1 1-1h4v1.5H2.5V6H1V2Zm9 0V1h4a1 1 0 0 1 1 1v4h-1.5V2.5H10ZM1 10h1.5v3.5H6V15H2a1 1 0 0 1-1-1v-4Zm13 0H15v4a1 1 0 0 1-1 1h-4v-1.5h3.5V10Z"
    clip-rule="evenodd"
  />
</svg>`

const FENCE_START_LINE = /(?:^|\s)startLine=(\d+)/

export type CodeFence = {
  language: string
  lineNumbers: boolean
  startLine?: number
}

/** Parse the information string consistently for Streamdown and Marked. */
export function parseCodeFence(info?: string | null): CodeFence {
  const [language = "", ...metaParts] = (info ?? "").trim().split(/\s+/)
  const meta = metaParts.join(" ")
  const startRaw = meta.match(FENCE_START_LINE)?.[1]
  const startLine = startRaw ? Number.parseInt(startRaw, 10) : undefined

  return {
    language,
    lineNumbers: !/(?:^|\s)noLineNumbers(?:\s|$)/.test(meta),
    startLine: startLine && startLine >= 1 ? startLine : undefined,
  }
}

export function codeFilename(language: string) {
  const extension = CODE_FILE_EXTENSIONS[language.toLowerCase()] ?? "txt"
  return `file.${extension}`
}

const CODE_FILE_EXTENSIONS: Record<string, string> = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  css: "css",
  go: "go",
  html: "html",
  java: "java",
  javascript: "js",
  js: "js",
  json: "json",
  jsx: "jsx",
  markdown: "md",
  md: "md",
  php: "php",
  python: "py",
  py: "py",
  rust: "rs",
  sh: "sh",
  shell: "sh",
  sql: "sql",
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  xml: "xml",
  yaml: "yaml",
  yml: "yml",
}

export function isExternalMarkdownLink(href: string) {
  return /^https?:\/\//i.test(href)
}

/** URLs accepted from Markdown links and images. */
export function safeMarkdownUrl(value: string, image = false) {
  const href = value.trim()
  if (!href) return null
  if (href.startsWith("#") || href.startsWith("/")) return href
  try {
    const url = new URL(href)
    if (["http:", "https:"].includes(url.protocol)) return href
    if (!image && ["mailto:", "tel:"].includes(url.protocol)) return href
  } catch {
    return null
  }
  return null
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/** HTML-only adapter for Marked's custom code token renderer. */
export function renderStaticCodeBlock(
  source: string,
  info?: string | null,
  highlighted?: string[]
) {
  const fence = parseCodeFence(info)
  const language = escapeHtml(fence.language || "code")
  const start = fence.startLine ? ` data-start-line="${fence.startLine}"` : ""
  const lineStyle = ` style="--markdown-start-line:${fence.startLine ?? 1}"`
  const lineNumbers = fence.lineNumbers
    ? ` data-line-numbers=""${start}${lineStyle}`
    : ""
  const lines = highlighted ?? source.split("\n").map(escapeHtml)

  return /* HTML */ `<div
    class="${MARKDOWN_BLOCK_SHELL} overflow-hidden"
    data-markdown-code-block=""
  >
    <div class="${MARKDOWN_BLOCK_TOPBAR}" data-find-skip>
      <span class="${MARKDOWN_BLOCK_LABEL}" data-markdown-language="${language}"
        >${language}</span
      >
      <div class="flex shrink-0 items-center gap-1">
        <button
          class="${MARKDOWN_ICON_BUTTON}"
          type="button"
          aria-label="Download file"
          data-markdown-tooltip="Download file"
          data-markdown-action="${MARKDOWN_ACTION.downloadCode}"
        >
          ${DOWNLOAD_ICON}
        </button>
        <button
          class="${MARKDOWN_ICON_BUTTON}"
          type="button"
          aria-label="Copy code"
          data-markdown-tooltip="Copy code"
          data-markdown-action="${MARKDOWN_ACTION.copyCode}"
        >
          ${COPY_ICON}
        </button>
      </div>
    </div>
    <pre
      class="overflow-x-auto bg-transparent p-3 text-sm"
      ${lineNumbers}
    ><code class="font-mono">${lines
      .map(
        (line) =>
          /* HTML */ `<span data-markdown-code-line="">${line || " "}</span>`
      )
      .join("")}</code></pre>
  </div>`
}

/** HTML-only adapter for Marked's table token renderer. */
function renderStaticTableToolbar() {
  return /* HTML */ `<div class="${MARKDOWN_BLOCK_TOPBAR}" data-find-skip>
    <span class="${MARKDOWN_BLOCK_LABEL}">table</span>
    <div class="flex shrink-0 items-center">
      <button
        class="${MARKDOWN_ICON_BUTTON}"
        type="button"
        aria-haspopup="menu"
        aria-label="Copy table"
        data-markdown-tooltip="Copy table"
        data-markdown-action="${MARKDOWN_ACTION.openCopyMenu}"
      >
        ${COPY_ICON}
      </button>
      <button
        class="${MARKDOWN_ICON_BUTTON}"
        type="button"
        aria-haspopup="menu"
        aria-label="Download table"
        data-markdown-tooltip="Download table"
        data-markdown-action="${MARKDOWN_ACTION.openDownloadMenu}"
      >
        ${DOWNLOAD_ICON}
      </button>
      <button
        class="${MARKDOWN_ICON_BUTTON}"
        type="button"
        aria-label="View fullscreen"
        data-markdown-tooltip="View fullscreen"
        data-markdown-action="${MARKDOWN_ACTION.fullscreenTable}"
      >
        ${FULLSCREEN_ICON}
      </button>
    </div>
  </div>`
}

export function renderStaticTable(table: string) {
  return /* HTML */ `<div
    class="${MARKDOWN_BLOCK_SHELL} overflow-hidden"
    data-markdown-table=""
    data-streamdown="table-wrapper"
  >
    ${renderStaticTableToolbar()}
    <div class="min-w-0 overflow-x-auto rounded-b-xl">${table}</div>
  </div>`
}
