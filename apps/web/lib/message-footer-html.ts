import type { IconSvgElement } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  GitBranchIcon,
  InformationCircleIcon,
  Refresh01Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const MESSAGE_FOOTER_ACTION = {
  copy: "copy",
  delete: "delete",
  details: "details",
  edit: "edit",
  nextSibling: "next-sibling",
  previousSibling: "previous-sibling",
  generate: "generate",
  toggleContext: "toggle-context",
} as const

export type MessageFooterAction =
  (typeof MESSAGE_FOOTER_ACTION)[keyof typeof MESSAGE_FOOTER_ACTION]

type FooterIdentity = {
  label: string | null
  title: string | null
  hasDetails: boolean
  createdTime: string | null
  providerName: string | null
  modelName: string | null
}

export type MessageFooterHtmlModel = {
  captions: boolean
  contextExcluded: boolean
  contextPending: boolean
  identity: FooterIdentity
  showDetailsAction: boolean
  showEdit: boolean
  /** "answer" adds a child under a user message. "regenerate" adds a sibling of an assistant. */
  generate: "answer" | "regenerate" | null
  siblingCount: number
  siblingIndex: number
}

export type MessageFooterHtml = {
  actions: { __html: string }
  identity: { __html: string }
}

const META_CLASS =
  "flex min-w-0 flex-1 items-center text-left text-[11px] text-muted-foreground outline-none hover:text-foreground"
const META_TEXT_CLASS =
  "min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
const META_SEPARATOR =
  '<span aria-hidden="true" class="mx-1.5 h-3 w-px shrink-0 bg-foreground/20"></span>'

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character
  )
}

function svgAttribute(name: string) {
  return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
}

function renderIcon(icon: IconSvgElement, shrink = true) {
  const children = [...icon]
    .sort(([, left], [, right]) => {
      const leftHasOpacity = left.opacity !== undefined
      const rightHasOpacity = right.opacity !== undefined
      return rightHasOpacity ? 1 : leftHasOpacity ? -1 : 0
    })
    .map(([tag, attributes]) => {
      const serialized = Object.entries(attributes)
        .filter(([name]) => name !== "key")
        .map(([name, value]) => {
          const overridden =
            name === "strokeWidth"
              ? 2
              : name === "stroke"
                ? "currentColor"
                : value
          return `${svgAttribute(name)}="${escapeHtml(String(overridden))}"`
        })
        .join(" ")
      return `<${tag} ${serialized}></${tag}>`
    })
    .join("")

  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" color="currentColor" stroke-width="2" stroke="currentColor" class="size-3.5${shrink ? " shrink-0" : ""}" aria-hidden="true">${children}</svg>`
}

function actionClass(captions: boolean, destructive = false) {
  return buttonVariants({
    variant: "ghost",
    size: captions ? "xs" : "icon-xs",
    className: cn(
      captions
        ? "h-7 gap-1 px-2 text-xs font-normal"
        : "size-7 text-muted-foreground hover:text-foreground",
      destructive && "text-destructive hover:text-destructive"
    ),
  })
}

type ActionButtonOptions = {
  action: MessageFooterAction
  captions: boolean
  destructive?: boolean
  disabled?: boolean
  icon: IconSvgElement
  label: string
}

function actionButton({
  action,
  captions,
  destructive,
  disabled,
  icon,
  label,
}: ActionButtonOptions) {
  const tooltip = captions
    ? ""
    : ` data-static-tooltip="${escapeHtml(label)}" data-static-tooltip-gap="4"`
  const disabledAttribute = disabled ? ' disabled=""' : ""
  const caption = captions
    ? `<span class="leading-none">${escapeHtml(label)}</span>`
    : ""
  return `<button type="button" data-slot="button" data-theme-group="button" data-theme-target="button" data-message-footer-action="${action}" aria-label="${escapeHtml(label)}" class="${actionClass(captions, destructive)}"${tooltip}${disabledAttribute}>${renderIcon(icon)}${caption}</button>`
}

function siblingStepper(index: number, count: number) {
  const buttonClass = buttonVariants({ variant: "ghost", size: "icon-xs" })
  const previousDisabled = index === 0 ? ' disabled=""' : ""
  const nextDisabled = index === count - 1 ? ' disabled=""' : ""
  return `<span class="flex items-center gap-1"><button type="button" data-slot="button" data-theme-group="button" data-theme-target="button" data-message-footer-action="${MESSAGE_FOOTER_ACTION.previousSibling}" aria-label="Previous branch" data-static-tooltip="Previous branch" data-static-tooltip-gap="4" class="${buttonClass}"${previousDisabled}>${renderIcon(ArrowLeft01Icon, false)}</button><span aria-live="polite">${index + 1}/${count}</span><button type="button" data-slot="button" data-theme-group="button" data-theme-target="button" data-message-footer-action="${MESSAGE_FOOTER_ACTION.nextSibling}" aria-label="Next branch" data-static-tooltip="Next branch" data-static-tooltip-gap="4" class="${buttonClass}"${nextDisabled}>${renderIcon(ArrowRight01Icon, false)}</button></span>`
}

function renderIdentity(identity: FooterIdentity) {
  if (!identity.label) return '<span class="min-w-0 flex-1"></span>'
  if (!identity.hasDetails) {
    return `<span title="${escapeHtml(identity.title ?? identity.label)}" class="${META_TEXT_CLASS}">${escapeHtml(identity.label)}</span>`
  }

  const parts: string[] = []
  if (identity.createdTime)
    parts.push(
      `<span class="shrink-0">${escapeHtml(identity.createdTime)}</span>`
    )
  if (identity.providerName) {
    if (identity.createdTime) parts.push(META_SEPARATOR)
    parts.push(
      `<span class="min-w-0 truncate">${escapeHtml(identity.providerName)}</span>`
    )
  }
  if (identity.modelName) {
    if (identity.createdTime || identity.providerName)
      parts.push(META_SEPARATOR)
    parts.push(
      `<span class="min-w-0 truncate">${escapeHtml(identity.modelName)}</span>`
    )
  }
  return `<button type="button" title="${escapeHtml(identity.title ?? identity.label)}" aria-label="Message details" data-message-footer-action="${MESSAGE_FOOTER_ACTION.details}" class="${META_CLASS}">${parts.join("")}</button>`
}

function renderActions(model: MessageFooterHtmlModel) {
  const actions: string[] = []
  const add = (options: ActionButtonOptions) => {
    actions.push(actionButton(options))
  }
  if (model.siblingCount > 1 && model.siblingIndex >= 0)
    actions.push(siblingStepper(model.siblingIndex, model.siblingCount))
  add({
    action: MESSAGE_FOOTER_ACTION.copy,
    captions: model.captions,
    icon: Copy01Icon,
    label: "Copy",
  })
  if (model.generate === "answer" || model.generate === "regenerate")
    add({
      action: MESSAGE_FOOTER_ACTION.generate,
      captions: model.captions,
      icon: model.generate === "regenerate" ? Refresh01Icon : GitBranchIcon,
      label: model.generate === "regenerate" ? "Regenerate" : "Another answer",
    })
  if (model.showEdit)
    add({
      action: MESSAGE_FOOTER_ACTION.edit,
      captions: model.captions,
      icon: Edit02Icon,
      label: "Edit",
    })
  add({
    action: MESSAGE_FOOTER_ACTION.toggleContext,
    captions: model.captions,
    disabled: model.contextPending,
    icon: model.contextExcluded ? ViewOffIcon : ViewIcon,
    label: model.contextExcluded
      ? "Include in context"
      : "Exclude from context",
  })
  if (model.showDetailsAction)
    add({
      action: MESSAGE_FOOTER_ACTION.details,
      captions: model.captions,
      icon: InformationCircleIcon,
      label: "Details",
    })
  add({
    action: MESSAGE_FOOTER_ACTION.delete,
    captions: model.captions,
    destructive: true,
    icon: Delete02Icon,
    label: "Delete",
  })
  return { __html: actions.join("") }
}

export class MessageFooterHtmlCache {
  private readonly entries = new Map<string, MessageFooterHtml>()

  constructor(private readonly limit = 2_000) {}

  get(model: MessageFooterHtmlModel) {
    const key = JSON.stringify(model)
    const cached = this.entries.get(key)
    if (cached) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached
    }

    const entry = {
      actions: renderActions(model),
      identity: { __html: renderIdentity(model.identity) },
    }
    this.entries.set(key, entry)
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    return entry
  }
}

const footerHtmlCache = new MessageFooterHtmlCache()

export function prepareMessageFooterHtml(model: MessageFooterHtmlModel) {
  return footerHtmlCache.get(model)
}
