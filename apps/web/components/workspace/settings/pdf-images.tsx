"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTRPC } from "@/lib/trpc-react"

export function PdfImageSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery(trpc.workspace.getSettings.queryOptions())
  const savedLimit = settingsQuery.data?.pdfImagePageLimit ?? 8
  const [draft, setDraft] = useState<string | null>(null)
  const limitRef = useRef<HTMLInputElement>(null)
  const draftInvalid = draft !== null && !isPositivePageLimit(Number(draft))

  useEffect(() => {
    const node = limitRef.current
    if (!node) return
    const blockWheel = (event: WheelEvent) => {
      if (document.activeElement === node) event.preventDefault()
    }
    node.addEventListener("wheel", blockWheel, { passive: false })
    return () => node.removeEventListener("wheel", blockWheel)
  }, [])

  const setMut = useMutation(
    trpc.workspace.setPdfImagePageLimit.mutationOptions({
      onSuccess: async ({ pdfImagePageLimit }) => {
        setDraft(String(pdfImagePageLimit))
        await queryClient.invalidateQueries({
          queryKey: trpc.workspace.getSettings.queryKey(),
        })
        setDraft(null)
      },
      onError: (error) => {
        setDraft(null)
        toast.error(error.message || "Could not save page limit")
      },
    })
  )

  function save() {
    const pageLimit = Number(draft ?? savedLimit)
    if (!isPositivePageLimit(pageLimit)) {
      toast.error("Enter a positive whole number of pages")
      return
    }
    if (pageLimit === savedLimit) {
      setDraft(null)
      return
    }
    setMut.mutate({ pageLimit })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>PDF pages as images</CardTitle>
        <CardDescription>
          When a model uses Images for PDFs, this limits the pages sent across a
          chat’s active context. The default is 8 pages. Large values can make
          requests slower or exceed provider limits.
        </CardDescription>
      </CardHeader>
      <CardContent className="max-w-xs space-y-1.5">
        <Label htmlFor="pdf-image-page-limit">Page limit</Label>
        <Input
          ref={limitRef}
          id="pdf-image-page-limit"
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={draft ?? String(savedLimit)}
          disabled={settingsQuery.isPending || setMut.isPending}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur()
          }}
          aria-invalid={draftInvalid || undefined}
          aria-describedby="pdf-image-page-limit-help"
        />
        <p
          id="pdf-image-page-limit-help"
          className="text-xs text-muted-foreground"
        >
          No fixed maximum. The limit is checked before a request is sent.
        </p>
      </CardContent>
    </Card>
  )
}

function isPositivePageLimit(pageLimit: number) {
  return Number.isSafeInteger(pageLimit) && pageLimit >= 1
}
