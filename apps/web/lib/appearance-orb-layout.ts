/**
 * Layout math for magic orbs: satellite buttons ride outside the main pencil
 * on a circle centered on the pencil, arc running top → left.
 */

export type OrbLayout = {
  mainSize: number
  smallSize: number
  /** Gap between main rim and satellite rim */
  edgeGap: number
  /** Clear space between the two satellite rims along the orbit arc */
  seamGap: number
}

export type SatellitePlacement = {
  id: "save" | "close"
  /** Offset of satellite center from main center (x right, y down) */
  x: number
  y: number
  /** Angle from +x axis, CCW in mathematical plane (y up), radians */
  theta: number
}

/** Default sizes: main ~2× a 56px orb; small orbs stay ≥44px taps. */
export const DEFAULT_ORB_LAYOUT: OrbLayout = {
  mainSize: 112,
  smallSize: 48,
  edgeGap: 12,
  seamGap: 16,
}

/**
 * Orbit radius (main center → satellite center):
 * main radius + edge gap + satellite radius (sits just outside big orb rim).
 */
export function orbitRadius(layout: OrbLayout): number {
  return layout.mainSize / 2 + layout.edgeGap + layout.smallSize / 2
}

/**
 * Minimum center-to-center arc length so satellite circles do not intersect
 * plus intentional seam: 2 * smallR + seamGap.
 */
export function minArcSeparation(layout: OrbLayout): number {
  return layout.smallSize + layout.seamGap
}

/**
 * Place Save at the top of the main orb, Close further along the curvature
 * toward the left. Separation uses equal-arc spacing from minArcSeparation.
 */
export function placeSatellitesOnArc(
  layout: OrbLayout = DEFAULT_ORB_LAYOUT
): SatellitePlacement[] {
  const R = orbitRadius(layout)
  const arc = minArcSeparation(layout)
  // Δθ from arc length s = R·θ
  const dTheta = arc / R

  // Math angles (y up): top = π/2, leftward is increasing θ (CCW).
  // Screen (y down): x = R cos θ, y = −R sin θ
  const saveTheta = Math.PI / 2
  const closeTheta = saveTheta + dTheta

  return [
    {
      id: "save",
      theta: saveTheta,
      x: R * Math.cos(saveTheta),
      y: -R * Math.sin(saveTheta),
    },
    {
      id: "close",
      theta: closeTheta,
      x: R * Math.cos(closeTheta),
      y: -R * Math.sin(closeTheta),
    },
  ]
}

/** Padding needed so absolute satellites fit around a bottom-right-anchored main. */
export function orbitClusterPadding(layout: OrbLayout = DEFAULT_ORB_LAYOUT): {
  top: number
  left: number
  /** Cluster box size containing main + orbit satellites */
  width: number
  height: number
} {
  const placements = placeSatellitesOnArc(layout)
  const mainR = layout.mainSize / 2
  const smallR = layout.smallSize / 2
  // Main center is at (width - mainR, height - mainR) in a tight box.
  // Satellites extend mainCenter + (x,y) ± smallR.
  let minX = -mainR
  let minY = -mainR
  let maxX = mainR
  let maxY = mainR
  for (const p of placements) {
    minX = Math.min(minX, p.x - smallR)
    minY = Math.min(minY, p.y - smallR)
    maxX = Math.max(maxX, p.x + smallR)
    maxY = Math.max(maxY, p.y + smallR)
  }
  // Shift so min is 0
  const left = -minX
  const top = -minY
  return {
    top,
    left,
    width: maxX - minX,
    height: maxY - minY,
  }
}
