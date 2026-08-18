/** Copy plain text. Throws if the clipboard is unavailable or the write fails. */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  if (typeof document === "undefined") throw new Error("Clipboard unavailable")
  const el = document.createElement("textarea")
  el.value = text
  el.setAttribute("readonly", "")
  el.style.position = "fixed"
  el.style.left = "-9999px"
  document.body.appendChild(el)
  el.select()
  const ok = document.execCommand("copy")
  document.body.removeChild(el)
  if (!ok) throw new Error("Copy failed")
}
