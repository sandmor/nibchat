"use client"

import { useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type ImageViewerItem = {
  src: string
  name: string
}

export function ImageViewer({
  image,
  onClose,
}: {
  image: ImageViewerItem | null
  onClose: () => void
}) {
  const lastImage = useRef<ImageViewerItem | null>(null)
  if (image) lastImage.current = image
  const shown = image ?? lastImage.current

  return (
    <Dialog
      open={image !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="max-h-[90vh] w-[min(56rem,calc(100%-2rem))] gap-3 overflow-hidden p-4 sm:max-w-[56rem]"
        showCloseButton
      >
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate pr-10 text-sm font-medium">
            {shown?.name ?? "Image"}
          </DialogTitle>
        </DialogHeader>
        {shown ? (
          <div className="flex min-h-0 flex-col gap-2">
            <img
              src={shown.src}
              alt={shown.name}
              className="mx-auto max-h-[min(75vh,40rem)] max-w-full object-contain"
            />
            <a
              href={shown.src}
              target="_blank"
              rel="noreferrer"
              download={shown.name}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Open original
            </a>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
