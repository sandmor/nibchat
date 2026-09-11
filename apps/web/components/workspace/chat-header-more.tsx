"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { CircleEllipsisIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type ChatHeaderMoreItem = {
  label: string
  onSelect: () => void
}

export function ChatHeaderMore({
  items,
  compactItems = [],
}: {
  items: ChatHeaderMoreItem[]
  compactItems?: ChatHeaderMoreItem[]
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label="More"
          />
        }
      >
        <HugeiconsIcon
          icon={CircleEllipsisIcon}
          strokeWidth={2}
          className="size-4"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {compactItems.map((item) => (
          <DropdownMenuItem
            key={item.label}
            className="md:hidden"
            onClick={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
        {compactItems.length > 0 ? (
          <DropdownMenuSeparator className="md:hidden" />
        ) : null}
        {items.map((item) => (
          <DropdownMenuItem key={item.label} onClick={item.onSelect}>
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
