"use client"

import { useId } from "react"
import { cn } from "@/lib/utils"

export function Logo({
  className,
  alt = "",
}: {
  className?: string
  alt?: string
}) {
  const gradientId = useId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="60 55 405 405"
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      focusable="false"
      width={32}
      height={32}
      className={cn("block size-7 shrink-0 object-contain", className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="100%" y1="0%" x2="0%" y2="100%">
          <stop
            offset="0%"
            className="[stop-color:#009BD6] dark:[stop-color:#67D8FF]"
          />
          <stop
            offset="50%"
            className="[stop-color:#0052A5] dark:[stop-color:#38BDF8]"
          />
          <stop
            offset="100%"
            className="[stop-color:#0A255C] dark:[stop-color:#3B82F6]"
          />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        <path
          fillRule="evenodd"
          d="M260 70 A180 180 0 1 0 321.6 419.1 L445 445 L407.4 353.2 A180 180 0 0 0 260 70 Z M260 120 A130 130 0 1 1 259.9 120 Z"
        />
        <path
          fillRule="evenodd"
          d="M258.5 153 H261.5 L310 250 L294 290 V315 H226 V290 L210 250 Z M258.5 153 H261.5 V230 A10 10 0 1 1 258.5 230 Z"
        />
        <rect x="222" y="327" width="76" height="14" rx="7" />
      </g>
    </svg>
  )
}

export function BrandMark({
  className,
  logoClassName,
  wordmark = true,
}: {
  className?: string
  logoClassName?: string
  wordmark?: boolean
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Logo className={logoClassName} alt={wordmark ? "" : "Nibchat"} />
      {wordmark ? (
        <span className="truncate font-semibold tracking-tight">Nibchat</span>
      ) : null}
    </span>
  )
}
