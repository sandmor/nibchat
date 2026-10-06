"use client"

import { useEffect, useRef, useState } from "react"
import type { ProviderSummary } from "../types"
import { ProviderSettings } from "./providers"
import { TitleModelSettings } from "./title-model"
import { PromptStackSettings } from "./prompt-stacks"
import { ContextBookSettings } from "./context-books"
import { ChatDefaultsSettings } from "./chat-defaults"
import { BuiltInToolsSettings } from "./builtin-tools"
import { PdfImageSettings } from "./pdf-images"
import { BackupSettings } from "./backup"
import { AppearanceSettings } from "./appearance"
import { McpSettings } from "./mcp"
import { UsersSettings } from "./users"
import { ConversationImportSettings } from "./conversation-import"
import { ChatTemplateSettings } from "./chat-templates"
import { ScheduleSettings } from "./schedules"
import { HelperSettings } from "./helpers"
import { ActivitySettings } from "./activity"
import { cn } from "@/lib/utils"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWorkspaceChrome } from "../shell"
import {
  sectionIdForHash,
  SETTINGS_SECTIONS,
  visibleSettingsSections,
  type SettingsSectionId,
} from "./sections"

export function SettingsPanel({
  providers,
  onProvidersChange,
  isOwner,
  activityChatId,
}: {
  providers: ProviderSummary[]
  onProvidersChange: () => void
  isOwner: boolean
  activityChatId?: string
}) {
  const { appearance } = useWorkspaceChrome()
  const compact = appearance.density === "compact"
  const sections = visibleSettingsSections(isOwner)
  const [section, setSection] = useState<SettingsSectionId>("chat")
  const scrollerRef = useRef<HTMLDivElement>(null)
  const active = SETTINGS_SECTIONS.find((item) => item.id === section)!

  useEffect(() => {
    const sync = () => {
      setSection(sectionIdForHash(window.location.hash, isOwner))
    }
    sync()
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [isOwner])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const id = window.location.hash.slice(1)
    const card =
      sectionIdForHash(window.location.hash, isOwner) === section &&
      id !== section
        ? document.getElementById(id)
        : null
    if (card) card.scrollIntoView({ block: "start" })
    else scroller.scrollTo({ top: 0 })
  }, [section, isOwner])

  function selectSection(value: unknown) {
    const next = sections.find((item) => item.id === value)
    if (!next) return
    setSection(next.id)
    if (window.location.hash === `#${next.id}`) return
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${next.id}`
    )
  }

  const column = cn("w-full", compact ? "px-3" : "px-4 sm:px-8")

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <Tabs
        value={section}
        onValueChange={selectSection}
        className="min-h-0 flex-1 gap-0 overflow-hidden"
      >
        <div
          className={cn(
            "shrink-0 border-b",
            compact ? "pt-3" : "pt-4 sm:pt-5"
          )}
        >
          <div className={column}>
            <p className="text-xs font-semibold tracking-[.18em] text-primary uppercase">
              {isOwner ? "Instance controls" : "Personal settings"}
            </p>
            <h1 className="mt-1 text-lg font-semibold text-pretty sm:text-xl">
              {active.label}
            </h1>
            <div className="mt-3 overflow-x-auto pb-2">
              <TabsList
                variant="line"
                aria-label="Settings sections"
                className="w-max justify-start bg-transparent"
              >
                {sections.map((item) => (
                  <TabsTrigger
                    key={item.id}
                    value={item.id}
                    className="flex-none"
                  >
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        </div>
        <div
          ref={scrollerRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {sections.map((item) => (
            <TabsContent
              key={item.id}
              value={item.id}
              keepMounted
              className="outline-none"
            >
              <div
                data-theme-group="settings"
                className={cn(
                  "grid",
                  compact ? "gap-4 py-3" : "gap-6 py-4 sm:gap-7 sm:py-8",
                  column
                )}
              >
                <SectionCards
                  id={item.id}
                  providers={providers}
                  onProvidersChange={onProvidersChange}
                  isOwner={isOwner}
                  activityChatId={activityChatId}
                />
              </div>
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </section>
  )
}

function SectionCards({
  id,
  providers,
  onProvidersChange,
  isOwner,
  activityChatId,
}: {
  id: SettingsSectionId
  providers: ProviderSummary[]
  onProvidersChange: () => void
  isOwner: boolean
  activityChatId?: string
}) {
  switch (id) {
    case "chat":
      return (
        <>
          <ChatDefaultsSettings providers={providers} />
          <TitleModelSettings providers={providers} isOwner={isOwner} />
          <PdfImageSettings />
          <BuiltInToolsSettings />
        </>
      )
    case "libraries":
      return (
        <>
          <PromptStackSettings />
          <ContextBookSettings />
          <ChatTemplateSettings />
          <HelperSettings providers={providers} />
        </>
      )
    case "connections":
      return (
        <>
          <div id="providers">
            <ProviderSettings
              providers={providers}
              onSaved={onProvidersChange}
            />
          </div>
          <McpSettings />
        </>
      )
    case "appearance":
      return <AppearanceSettings />
    case "activity":
      return (
        <ActivitySettings
          isOwner={isOwner}
          chatId={activityChatId}
          providers={providers}
        />
      )
    case "instance":
      return (
        <>
          <ScheduleSettings />
          <ConversationImportSettings />
          {isOwner ? (
            <>
              <BackupSettings />
              <UsersSettings />
            </>
          ) : null}
        </>
      )
  }
}
