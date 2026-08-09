"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, animate, motion } from "motion/react"
import { toast } from "sonner"
import { useMutation } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  FloppyDiskIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { useTRPC } from "@/lib/trpc-react"
import {
  isAppearanceDirty,
  useAppearanceStore,
} from "@/lib/appearance-store"
import {
  DEFAULT_ORB_LAYOUT,
  orbitClusterPadding,
  placeSatellitesOnArc,
} from "@/lib/appearance-orb-layout"
import { AppearancePickLayer } from "./pick-layer"
import { SurfaceColorPicker } from "./surface-color-picker"

const LAYOUT = DEFAULT_ORB_LAYOUT
const pads = orbitClusterPadding(LAYOUT)
const satellites = placeSatellitesOnArc(LAYOUT)
const mainCx = pads.left
const mainCy = pads.top

const ORB_EDGE_PAD = 20 // breathing room past viewport edge / classic scrollbar

const scaleSpring = {
  type: "spring" as const,
  stiffness: 480,
  damping: 28,
  mass: 0.8,
}

const tapScale = 0.88

/**
 * Tap press + release before an action that unmounts the cluster.
 * Skips if the node is gone; otherwise always completes pulse then caller exits.
 */
async function playTapPulse(node: HTMLElement | null) {
  if (!node || !node.isConnected) return
  await animate(
    node,
    { scale: tapScale },
    { duration: 0.09, ease: [0.22, 1, 0.36, 1] }
  )
  if (!node.isConnected) return
  await animate(
    node,
    { scale: 1 },
    { duration: 0.12, ease: [0.22, 1, 0.36, 1] }
  )
}

/** Classic layout scrollbar occupies right edge; overlay scrollbars report 0. */
function useRightEdgeInset() {
  const [right, setRight] = useState(ORB_EDGE_PAD)
  useEffect(() => {
    function measure() {
      const scrollbar = Math.max(
        0,
        window.innerWidth - document.documentElement.clientWidth
      )
      setRight(ORB_EDGE_PAD + scrollbar)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])
  return right
}

const smallOrbClass = cn(
  "absolute flex items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md",
  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
)

const orbMotion = {
  initial: { scale: 0, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: {
    scale: 0,
    opacity: 0,
    transition: { ...scaleSpring, delay: 0 },
  },
}

export function AppearanceMagicChrome() {
  const open = useAppearanceStore((s) => s.open)
  const pickArmed = useAppearanceStore((s) => s.pickArmed)
  const draft = useAppearanceStore((s) => s.draft)
  const saved = useAppearanceStore((s) => s.saved)
  const closeMagic = useAppearanceStore((s) => s.closeMagic)
  const markSaved = useAppearanceStore((s) => s.markSaved)
  const togglePickArmed = useAppearanceStore((s) => s.togglePickArmed)
  const rightInset = useRightEdgeInset()

  const saveRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const actionGenRef = useRef(0)
  const [busy, setBusy] = useState(false)

  const trpc = useTRPC()
  const [saving, setSaving] = useState(false)
  const saveMutation = useMutation(
    trpc.workspace.setAppearance.mutationOptions()
  )

  const dirty = isAppearanceDirty(draft, saved)
  const savePlace = satellites.find((s) => s.id === "save")!
  const closePlace = satellites.find((s) => s.id === "close")!

  async function onSave() {
    if (!draft || saving || busy || !dirty) return
    const gen = ++actionGenRef.current
    setBusy(true)
    try {
      await playTapPulse(saveRef.current)
      if (gen !== actionGenRef.current) return
      setSaving(true)
      const next = await saveMutation.mutateAsync(draft)
      if (gen !== actionGenRef.current) return
      if (next) {
        markSaved(next)
        closeMagic()
        toast.success("Appearance saved")
      }
    } catch (error) {
      if (gen === actionGenRef.current) {
        toast.error(
          error instanceof Error ? error.message : "Could not save appearance"
        )
      }
    } finally {
      if (gen === actionGenRef.current) {
        setSaving(false)
        setBusy(false)
      }
    }
  }

  async function onClose() {
    if (busy || saving) return
    const gen = ++actionGenRef.current
    setBusy(true)
    try {
      await playTapPulse(closeRef.current)
      if (gen !== actionGenRef.current) return
      closeMagic()
    } finally {
      if (gen === actionGenRef.current) {
        setBusy(false)
      }
    }
  }

  return (
    <>
      {open && <AppearancePickLayer />}
      {open && <SurfaceColorPicker />}
      <div
        data-magic-chrome
        className="pointer-events-none fixed z-[90]"
        style={{
          right: `max(${rightInset}px, calc(env(safe-area-inset-right, 0px) + ${ORB_EDGE_PAD}px))`,
          bottom: `max(${ORB_EDGE_PAD}px, calc(env(safe-area-inset-bottom, 0px) + ${ORB_EDGE_PAD}px))`,
          width: pads.width,
          height: pads.height,
        }}
      >
        <div className="pointer-events-auto relative size-full">
          <AnimatePresence>
            {open && (
              <motion.button
                key="magic-save"
                ref={saveRef}
                type="button"
                onClick={() => void onSave()}
                disabled={!dirty || saving || busy || !draft}
                aria-label={dirty ? "Save appearance" : "Appearance saved"}
                title={dirty ? "Save" : "No changes"}
                className={cn(
                  smallOrbClass,
                  (!dirty || saving) && "opacity-50"
                )}
                style={{
                  width: LAYOUT.smallSize,
                  height: LAYOUT.smallSize,
                  left: mainCx + savePlace.x - LAYOUT.smallSize / 2,
                  top: mainCy + savePlace.y - LAYOUT.smallSize / 2,
                }}
                {...orbMotion}
                transition={{ ...scaleSpring, delay: 0.04 }}
              >
                <HugeiconsIcon
                  icon={FloppyDiskIcon}
                  strokeWidth={2}
                  className="size-5"
                />
                {dirty && (
                  <span
                    className="absolute top-1 right-1 size-2 rounded-full bg-amber-500"
                    aria-hidden
                  />
                )}
              </motion.button>
            )}
            {open && (
              <motion.button
                key="magic-close"
                ref={closeRef}
                type="button"
                onClick={() => void onClose()}
                disabled={busy || saving}
                aria-label="Close magic editor"
                title="Close"
                className={smallOrbClass}
                style={{
                  width: LAYOUT.smallSize,
                  height: LAYOUT.smallSize,
                  left: mainCx + closePlace.x - LAYOUT.smallSize / 2,
                  top: mainCy + closePlace.y - LAYOUT.smallSize / 2,
                }}
                {...orbMotion}
                transition={{ ...scaleSpring, delay: 0.08 }}
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  strokeWidth={2}
                  className="size-5"
                />
              </motion.button>
            )}
            {open && (
              <motion.button
                key="magic-main"
                type="button"
                onClick={() => togglePickArmed()}
                aria-label={
                  pickArmed
                    ? "Stop picking surfaces"
                    : "Pick a surface to recolor"
                }
                aria-pressed={pickArmed}
                title={
                  pickArmed ? "Pick mode on — tap again to stop" : "Pick mode"
                }
                className={cn(
                  "absolute flex items-center justify-center rounded-full border shadow-lg",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  pickArmed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted"
                )}
                style={{
                  width: LAYOUT.mainSize,
                  height: LAYOUT.mainSize,
                  left: mainCx - LAYOUT.mainSize / 2,
                  top: mainCy - LAYOUT.mainSize / 2,
                }}
                {...orbMotion}
                transition={scaleSpring}
                whileTap={{ scale: tapScale }}
              >
                <HugeiconsIcon
                  icon={PencilEdit01Icon}
                  strokeWidth={2}
                  className="size-8"
                />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}
