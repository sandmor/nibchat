"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Logout03Icon, Settings01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WithTooltip } from "@/components/ui/tooltip"
import { appearanceMagicStorageKey } from "@/lib/theme-slot"
import { cn } from "@/lib/utils"

async function signOut(userId: string) {
  const response = await fetch("/api/auth/sign-out", { method: "POST" })
  if (!response.ok) return
  try {
    localStorage.removeItem(appearanceMagicStorageKey(userId))
  } catch {
    /* ignore */
  }
  window.location.assign("/login")
}

function accountInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  const last = parts[parts.length - 1]
  if (!first) return "?"
  if (!last || parts.length === 1) return first.slice(0, 2).toUpperCase()
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase()
}

export function AccountMenu({
  user,
  isOwner,
  compact = false,
  menuSide = "top",
  menuAlign = "start",
  tooltipSide = "right",
}: {
  user: { id: string; name: string; email: string }
  isOwner: boolean
  compact?: boolean
  menuSide?: "top" | "bottom"
  menuAlign?: "start" | "end"
  tooltipSide?: "top" | "right" | "bottom"
}) {
  const initials = accountInitials(user.name)
  const trigger = compact ? (
    <DropdownMenuTrigger
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Account menu for ${user.name}`}
        />
      }
    >
      <span className="text-xs font-medium" aria-hidden>
        {initials}
      </span>
    </DropdownMenuTrigger>
  ) : (
    <DropdownMenuTrigger
      render={
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left",
            "outline-none hover:bg-sidebar-accent",
            "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
            "aria-expanded:bg-sidebar-accent"
          )}
          aria-label={`Account menu for ${user.name}`}
        />
      }
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[10px] font-medium"
        aria-hidden
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{user.name}</span>
          {isOwner ? (
            <Badge variant="secondary" className="shrink-0">
              Owner
            </Badge>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {user.email}
        </span>
      </span>
    </DropdownMenuTrigger>
  )

  return (
    <DropdownMenu>
      {compact ? (
        <WithTooltip label={user.name} side={tooltipSide}>
          {trigger}
        </WithTooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent
        align={menuAlign}
        side={menuSide}
        sideOffset={8}
        className="min-w-56"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm font-medium text-foreground">
              {user.name}
            </span>
            <span className="block truncate">{user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
          <HugeiconsIcon
            icon={Settings01Icon}
            strokeWidth={2}
            className="size-4 text-muted-foreground"
            aria-hidden
          />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => void signOut(user.id)}
        >
          <HugeiconsIcon
            icon={Logout03Icon}
            strokeWidth={2}
            className="size-4"
            aria-hidden
          />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
