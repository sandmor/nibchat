import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from "react"
import { cn } from "@/lib/utils"
import type { AppearanceMessageLayout } from "@/lib/appearance"

type Role = "user" | "assistant"

export function messageLayoutStyle(
  layout: AppearanceMessageLayout[Role]
): CSSProperties {
  return {
    maxWidth: `${layout.maxWidthPercent}%`,
    marginLeft:
      layout.align === "right" || layout.align === "center" ? "auto" : undefined,
    marginRight:
      layout.align === "left" || layout.align === "center" ? "auto" : undefined,
  }
}

export const MessageShell = forwardRef<
  HTMLElement,
  {
    role: Role
    tree?: boolean
    layout?: AppearanceMessageLayout[Role]
    className?: string
    children: ReactNode
  } & Omit<ComponentPropsWithoutRef<"article">, "role">
>(function MessageShell(
  { role, tree = false, layout, className, children, style, ...props },
  ref
) {
  return (
    <article
      ref={ref}
      data-theme-group={role === "user" ? "message-user" : "message-assistant"}
      data-theme-target={role === "user" ? "message-user" : "message-assistant"}
      style={{ ...(layout ? messageLayoutStyle(layout) : undefined), ...style }}
      className={cn(
        "group relative min-w-0 rounded-xl border outline-none",
        tree
          ? "flex h-full min-h-0 flex-col overflow-hidden hover:border-foreground/30"
          : "overflow-visible p-4",
        role === "user"
          ? "border-message-user-border bg-message-user text-message-user-foreground"
          : "border-message-assistant-border bg-message-assistant text-message-assistant-foreground",
        className
      )}
      {...props}
    >
      {children}
    </article>
  )
})
