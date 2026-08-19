import Image from "next/image"
import { cn } from "@/lib/utils"
import icon from "@/app/icon.svg"

export function Logo({
  className,
  alt = "",
}: {
  className?: string
  alt?: string
}) {
  return (
    <Image
      src={icon}
      alt={alt}
      width={32}
      height={32}
      unoptimized
      priority
      className={cn("block size-7 shrink-0 object-contain", className)}
    />
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
