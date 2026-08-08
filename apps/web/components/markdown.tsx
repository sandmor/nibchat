"use client"

import { Streamdown } from "streamdown"
import { code } from "@streamdown/code"
import { math } from "@streamdown/math"
import "katex/dist/katex.min.css"

const plugins = { code, math }

/** Assistant/user markdown with syntax highlighting and KaTeX. */
export function Markdown({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  return (
    <div className={className}>
      <Streamdown plugins={plugins}>{children}</Streamdown>
    </div>
  )
}
