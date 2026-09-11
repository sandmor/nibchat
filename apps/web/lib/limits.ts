/**
 * Shared size ceilings. Pick the bucket that matches the risk, do not invent
 * a nearby magic number.
 *
 * - Names go in chrome (lists, headers, pickers).
 * - Collections are user-defined rows (DoS bound, not a UX preference).
 * - Prompt text becomes model context; the composer token estimate is the
 *   window check, this is only storage.
 * - Blobs are extracted files, not typed prompts.
 * - Header values are HTTP/env-sized; they are not prompts.
 */
export const MAX_NAME = 200
export const MAX_COLLECTION = 100
export const MAX_PROMPT_CHARS = 50_000
export const MAX_BLOB_CHARS = 10_000_000
export const MAX_HEADER_VALUE_CHARS = 10_000

export const MAX_FILE_ATTACHMENTS = 4
export const MAX_FILE_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_FILE_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024

/** @alias MAX_BLOB_CHARS */
export const MAX_ATTACHMENT_TEXT_CHARS = MAX_BLOB_CHARS
