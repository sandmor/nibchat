export const FILE_SIGNATURE_BYTES = 12

export type SupportedAttachmentMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | "application/pdf"

type DetectedFileType = SupportedAttachmentMediaType | "application/zip"

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
  if (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
    return "application/pdf"
  return null
}

export function validateAttachmentSignature(
  signature: Uint8Array,
  declaredMediaType?: string
): SupportedAttachmentMediaType {
  const detected = detectFileType(signature)
  if (
    !detected ||
    detected === "application/zip" ||
    (declaredMediaType &&
      declaredMediaType !== "application/octet-stream" &&
      declaredMediaType !== detected)
  )
    throw new Error("Upload a valid JPEG, PNG, WebP, GIF, or PDF file")
  return detected
}

export async function validateAttachmentBlob(
  blob: Blob,
  declaredMediaType?: string
) {
  const signature = new Uint8Array(
    await blob.slice(0, FILE_SIGNATURE_BYTES).arrayBuffer()
  )
  return validateAttachmentSignature(signature, declaredMediaType)
}

export function looksLikeZip(bytes: Uint8Array) {
  return detectFileType(bytes) === "application/zip"
}
