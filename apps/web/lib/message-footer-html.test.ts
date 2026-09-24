import { describe, expect, it } from "vitest"
import {
  MESSAGE_FOOTER_ACTION,
  MessageFooterHtmlCache,
  type MessageFooterHtmlModel,
} from "@/lib/message-footer-html"

function footerModel(
  overrides: Partial<MessageFooterHtmlModel> = {}
): MessageFooterHtmlModel {
  return {
    captions: false,
    contextExcluded: false,
    contextPending: false,
    identity: {
      label: "5:00 PM | Provider | Model",
      title: "September 18, 2026 at 5:00 PM | Provider | Model",
      hasDetails: true,
      createdTime: "5:00 PM",
      providerName: "Provider",
      modelName: "Model",
    },
    showDetailsAction: false,
    showEdit: true,
    generate: "answer",
    siblingCount: 2,
    siblingIndex: 0,
    ...overrides,
  }
}

describe("message footer HTML cache", () => {
  it("reuses rendered entries and emits delegated native controls", () => {
    const cache = new MessageFooterHtmlCache(2)
    const model = footerModel()
    const first = cache.get(model)

    expect(cache.get(model)).toBe(first)
    expect(first.identity.__html).toContain(
      `data-message-footer-action="${MESSAGE_FOOTER_ACTION.details}"`
    )
    const actions = first.actions.__html
    expect(actions).toContain(
      `data-message-footer-action="${MESSAGE_FOOTER_ACTION.copy}"`
    )
    expect(actions).toContain('data-static-tooltip="Copy"')
    expect(actions).toContain("1/2")
    expect(actions).toContain('aria-label="Another answer"')
  })

  it("escapes metadata and reflects disabled action state", () => {
    const cache = new MessageFooterHtmlCache(2)
    const html = cache.get(
      footerModel({
        contextPending: true,
        identity: {
          label: '<script>alert("label")</script>',
          title: 'bad" onclick="alert(1)',
          hasDetails: true,
          createdTime: null,
          providerName: "<img src=x onerror=alert(1)>",
          modelName: null,
        },
      })
    )

    expect(html.identity.__html).not.toContain("<script")
    expect(html.identity.__html).not.toContain("<img")
    expect(html.identity.__html).not.toContain('onclick="alert')
    expect(html.identity.__html).toContain("&lt;img")
    expect(html.actions.__html).toMatch(
      /data-message-footer-action="toggle-context"[^>]* disabled=""/
    )
  })
})
