export const FILE_SIGNATURE_BYTES = 12

export type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"

type DetectedFileType = SupportedImageMediaType | "application/zip"

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]) {
  return (
    bytes.byteLength >= prefix.length &&
    prefix.every((value, index) => bytes[index] === value)
  )
}

/** Detect supported file types from the shortest prefix that identifies them. */
export function detectFileType(bytes: Uint8Array): DetectedFileType | null {
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png"
  if (
    hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  )
    return "image/gif"
  if (
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    hasPrefix(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  )
    return "image/webp"
  if (
    hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06])
  )
    return "application/zip"
  return null
}

export function validateImageSignature(
  signature: Uint8Array,
  declaredMediaType?: string
): SupportedImageMediaType {
  const detected = detectFileType(signature)
  if (
    !detected?.startsWith("image/") ||
    (declaredMediaType && declaredMediaType !== detected)
  )
    throw new Error("Upload a valid JPEG, PNG, WebP, or GIF image")
  return detected as SupportedImageMediaType
}

/** Read only enough of a Blob to validate its magic number. */
export async function validateImageBlob(
  blob: Blob,
  declaredMediaType?: string
) {
  const signature = new Uint8Array(
    await blob.slice(0, FILE_SIGNATURE_BYTES).arrayBuffer()
  )
  return validateImageSignature(signature, declaredMediaType)
}

export function looksLikeZip(bytes: Uint8Array) {
  return detectFileType(bytes) === "application/zip"
}
