"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { InformationCircleIcon } from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { TooltipProvider, WithTooltip } from "@/components/ui/tooltip"
import {
  KvEntriesEditor,
  StringListEditor,
  type KvEntry,
} from "@/components/workspace/settings/kv-entries"
import { useTRPC } from "@/lib/trpc-react"

const TRANSPORT_ITEMS = {
  "streamable-http": "Streamable HTTP",
  sse: "SSE (legacy)",
  stdio: "stdio",
} as const

const PROTOCOL_ITEMS = {
  auto: "Automatic (v2 with v1 fallback)",
  modern: "Modern v2 only",
} as const

type Transport = keyof typeof TRANSPORT_ITEMS
type ProtocolMode = keyof typeof PROTOCOL_ITEMS

type FormState = {
  name: string
  namespace: string
  transport: Transport
  protocolMode: ProtocolMode
  enabled: boolean
  url: string
  command: string
  args: string[]
  cwd: string
  headers: KvEntry[]
  env: KvEntry[]
  followRedirects: boolean
  connectTimeoutMs: string
  callTimeoutMs: string
}

type McpProfileListItem = {
  id: string
  name: string
  namespace: string
  enabled: boolean
  transport: Transport
  protocolMode: ProtocolMode
  runtimeSupported: boolean
  updated_at: string
  catalog: {
    tools: Array<{
      name: string
      title?: string
      description?: string
      fingerprint: string
    }>
    resources?: unknown[]
    prompts?: unknown[]
    instructions?: string
  }
  toolAllowlist: string[]
  config:
    | {
        url: string
        headers: Array<{ name: string; value: string }>
        followRedirects: boolean
        connectTimeoutMs: number
        callTimeoutMs: number
      }
    | {
        command: string
        args: string[]
        cwd?: string
        env: Array<{ name: string; value: string }>
        connectTimeoutMs: number
        callTimeoutMs: number
      }
}

type PendingReview = {
  catalog: McpProfileListItem["catalog"] & {
    tools: Array<{
      name: string
      title?: string
      description?: string
      fingerprint: string
    }>
  }
  selected: string[]
  diff: { added: string[]; removed: string[]; changed: string[] }
}

const emptyForm = (): FormState => ({
  name: "",
  namespace: "",
  transport: "streamable-http",
  protocolMode: "auto",
  enabled: true,
  url: "",
  command: "",
  args: [],
  cwd: "",
  headers: [],
  env: [],
  followRedirects: false,
  connectTimeoutMs: "10000",
  callTimeoutMs: "60000",
})

function profileToForm(profile: McpProfileListItem): FormState {
  if ("url" in profile.config) {
    return {
      name: profile.name,
      namespace: profile.namespace,
      transport: profile.transport,
      protocolMode: profile.protocolMode,
      enabled: profile.enabled,
      url: profile.config.url,
      command: "",
      args: [],
      cwd: "",
      headers: profile.config.headers,
      env: [],
      followRedirects: profile.config.followRedirects,
      connectTimeoutMs: String(profile.config.connectTimeoutMs),
      callTimeoutMs: String(profile.config.callTimeoutMs),
    }
  }
  return {
    name: profile.name,
    namespace: profile.namespace,
    transport: profile.transport,
    protocolMode: profile.protocolMode,
    enabled: profile.enabled,
    url: "",
    command: profile.config.command,
    args: [...profile.config.args],
    cwd: profile.config.cwd ?? "",
    headers: [],
    env: profile.config.env,
    followRedirects: false,
    connectTimeoutMs: String(profile.config.connectTimeoutMs),
    callTimeoutMs: String(profile.config.callTimeoutMs),
  }
}

function buildPayload(form: FormState) {
  const connectTimeoutMs = Number(form.connectTimeoutMs) || 10_000
  const callTimeoutMs = Number(form.callTimeoutMs) || 60_000
  const cleanEntries = (entries: KvEntry[]) =>
    entries
      .filter((entry) => entry.name.trim())
      .map((entry) => ({
        name: entry.name.trim(),
        value: entry.value,
      }))

  if (form.transport === "stdio") {
    return {
      name: form.name.trim(),
      namespace: form.namespace.trim(),
      enabled: form.enabled,
      transport: "stdio" as const,
      protocolMode: form.protocolMode,
      config: {
        command: form.command.trim(),
        args: form.args.map((a) => a.trim()).filter(Boolean),
        ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
        env: cleanEntries(form.env),
        connectTimeoutMs,
        callTimeoutMs,
      },
    }
  }
  return {
    name: form.name.trim(),
    namespace: form.namespace.trim(),
    enabled: form.enabled,
    transport: form.transport,
    protocolMode: form.protocolMode,
    config: {
      url: form.url.trim(),
      headers: cleanEntries(form.headers),
      followRedirects: form.followRedirects,
      connectTimeoutMs,
      callTimeoutMs,
    },
  }
}

export function McpSettings() {
  const trpc = useTRPC()
  const profilesQuery = useQuery(trpc.workspace.listMcpProfiles.queryOptions())
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, PendingReview>>({})
  const warnedRuntime = useRef(false)

  useEffect(() => {
    if (!profilesQuery.data || warnedRuntime.current) return
    const unsupported = profilesQuery.data.filter((p) => !p.runtimeSupported)
    if (unsupported.length) {
      warnedRuntime.current = true
      toast.warning(
        `${unsupported.length} MCP profile(s) unavailable in this runtime mode.`
      )
    }
  }, [profilesQuery.data])

  const refetch = () => profilesQuery.refetch()

  const createMut = useMutation(
    trpc.workspace.createMcpProfile.mutationOptions({
      onSuccess: async () => {
        toast.success("MCP server saved")
        setForm(emptyForm())
        setEditingId(null)
        await refetch()
      },
      onError: (error) =>
        toast.error(error.message || "Could not save MCP profile"),
    })
  )
  const updateMut = useMutation(
    trpc.workspace.updateMcpProfile.mutationOptions({
      onSuccess: async () => {
        toast.success("MCP server updated")
        setForm(emptyForm())
        setEditingId(null)
        await refetch()
      },
      onError: (error) =>
        toast.error(error.message || "Could not update MCP profile"),
    })
  )
  const deleteMut = useMutation(
    trpc.workspace.deleteMcpProfile.mutationOptions({
      onSuccess: async () => {
        toast.success("MCP server deleted")
        await refetch()
      },
      onError: (error) =>
        toast.error(error.message || "Could not delete MCP profile"),
    })
  )
  const refreshMut = useMutation(
    trpc.workspace.refreshMcpCatalog.mutationOptions({
      onSuccess: (result, variables) => {
        setPending((current) => ({
          ...current,
          [variables.id]: {
            catalog: result.catalog,
            selected: result.suggestedAllowlist,
            diff: result.diff,
          },
        }))
        toast.success("Catalog refreshed — review tools and approve.")
      },
      onError: (error) =>
        toast.error(error.message || "Could not refresh catalog"),
    })
  )
  const approveMut = useMutation(
    trpc.workspace.approveMcpCatalog.mutationOptions({
      onSuccess: async (_result, variables) => {
        setPending((current) => {
          const next = { ...current }
          delete next[variables.id]
          return next
        })
        toast.success("Approved tools updated")
        await refetch()
      },
      onError: (error) =>
        toast.error(error.message || "Could not approve catalog"),
    })
  )

  function save() {
    try {
      const payload = buildPayload(form)
      if (editingId) updateMut.mutate({ id: editingId, ...payload })
      else createMut.mutate(payload)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Invalid MCP configuration"
      )
    }
  }

  function toolBadge(
    name: string,
    diff?: PendingReview["diff"]
  ): "new" | "changed" | "removed" | null {
    if (!diff) return null
    if (diff.added.includes(name)) return "new"
    if (diff.changed.includes(name)) return "changed"
    if (diff.removed.includes(name)) return "removed"
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>MCP servers</CardTitle>
        <CardDescription>
          Connect MCP servers and approve tools the model may call. From chat,
          attach resources or insert prompts for selected servers. Prompt-stack
          MCP only places server initialize instructions — tools stay registered
          whenever the profile is enabled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="mcp-name">Name</Label>
            <Input
              id="mcp-name"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              placeholder="Filesystem"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5">
              <Label htmlFor="mcp-namespace" className="mb-0">
                Tool namespace (optional)
              </Label>
              <TooltipProvider delay={200}>
                <WithTooltip
                  side="top"
                  label="Prefixes tool names for the model (e.g. files__read) so two servers can expose the same tool name without colliding. Leave blank to derive from the display name."
                >
                  <button
                    type="button"
                    className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="About tool namespace"
                  >
                    <HugeiconsIcon
                      icon={InformationCircleIcon}
                      className="size-3.5"
                      strokeWidth={2}
                    />
                  </button>
                </WithTooltip>
              </TooltipProvider>
            </div>
            <Input
              id="mcp-namespace"
              value={form.namespace}
              onChange={(event) =>
                setForm({ ...form, namespace: event.target.value })
              }
              placeholder="Derived from name if blank"
            />
          </div>
          <div>
            <Label>Transport</Label>
            <Select
              value={form.transport}
              items={TRANSPORT_ITEMS}
              onValueChange={(value) =>
                value && setForm({ ...form, transport: value as Transport })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                <SelectItem value="sse">SSE (legacy)</SelectItem>
                <SelectItem value="stdio">stdio</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Protocol</Label>
            <Select
              value={form.protocolMode}
              items={PROTOCOL_ITEMS}
              onValueChange={(value) =>
                value &&
                setForm({ ...form, protocolMode: value as ProtocolMode })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  Automatic (v2 with v1 fallback)
                </SelectItem>
                <SelectItem value="modern">Modern v2 only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.transport === "stdio" ? (
            <>
              <div>
                <Label htmlFor="mcp-command">Command</Label>
                <Input
                  id="mcp-command"
                  value={form.command}
                  onChange={(event) =>
                    setForm({ ...form, command: event.target.value })
                  }
                  placeholder="npx"
                />
              </div>
              <div>
                <Label htmlFor="mcp-cwd">Working directory (optional)</Label>
                <Input
                  id="mcp-cwd"
                  value={form.cwd}
                  onChange={(event) =>
                    setForm({ ...form, cwd: event.target.value })
                  }
                  placeholder="/path/to/project"
                />
              </div>
              <StringListEditor
                label="Arguments"
                values={form.args}
                onChange={(args) => setForm({ ...form, args })}
                placeholder="-y"
              />
              <KvEntriesEditor
                label="Environment"
                entries={form.env}
                onChange={(env) => setForm({ ...form, env })}
                namePlaceholder="VAR_NAME"
                valuePlaceholder="${SECRET} or literal"
              />
            </>
          ) : (
            <>
              <div className="sm:col-span-2">
                <Label htmlFor="mcp-url">Server URL</Label>
                <Input
                  id="mcp-url"
                  type="url"
                  value={form.url}
                  onChange={(event) =>
                    setForm({ ...form, url: event.target.value })
                  }
                  placeholder="https://mcp.example.com/mcp"
                />
              </div>
              <KvEntriesEditor
                label="Headers"
                entries={form.headers}
                onChange={(headers) => setForm({ ...form, headers })}
                namePlaceholder="Authorization"
                valuePlaceholder="Bearer ${MCP_TOKEN}"
              />
              <div className="flex items-center gap-2 sm:col-span-2">
                <Switch
                  checked={form.followRedirects}
                  onCheckedChange={(followRedirects) =>
                    setForm({ ...form, followRedirects })
                  }
                  size="sm"
                />
                <span className="text-sm">Follow HTTP redirects</span>
              </div>
            </>
          )}
          <div>
            <Label htmlFor="mcp-connect-timeout">Connect timeout (ms)</Label>
            <Input
              id="mcp-connect-timeout"
              inputMode="numeric"
              value={form.connectTimeoutMs}
              onChange={(event) =>
                setForm({ ...form, connectTimeoutMs: event.target.value })
              }
            />
          </div>
          <div>
            <Label htmlFor="mcp-call-timeout">Call timeout (ms)</Label>
            <Input
              id="mcp-call-timeout"
              inputMode="numeric"
              value={form.callTimeoutMs}
              onChange={(event) =>
                setForm({ ...form, callTimeoutMs: event.target.value })
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button
              type="button"
              onClick={save}
              disabled={createMut.isPending || updateMut.isPending}
            >
              {editingId ? "Update MCP server" : "Add MCP server"}
            </Button>
            {editingId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingId(null)
                  setForm(emptyForm())
                }}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          {(profilesQuery.data as McpProfileListItem[] | undefined)?.map(
            (profile) => {
              const review = pending[profile.id]
              const approved = profile.catalog.tools
              const approvedNames = new Set(profile.toolAllowlist)
              return (
                <div key={profile.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{profile.name}</span>
                    <Badge variant="outline">{profile.transport}</Badge>
                    <Badge variant="outline">{profile.protocolMode}</Badge>
                    {!profile.runtimeSupported ? (
                      <Badge variant="destructive">
                        Unavailable in this runtime
                      </Badge>
                    ) : null}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {profile.namespace}__tool
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={profile.enabled}
                      size="sm"
                      disabled={updateMut.isPending}
                      onCheckedChange={(enabled) => {
                        const base = profileToForm(profile)
                        const payload = buildPayload({ ...base, enabled })
                        updateMut.mutate({ id: profile.id, ...payload })
                      }}
                    />
                    {profile.enabled ? "Enabled" : "Disabled"}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>
                      {(profile.catalog.resources ?? []).length} resource
                      {(profile.catalog.resources ?? []).length === 1
                        ? ""
                        : "s"}
                    </span>
                    <span>·</span>
                    <span>
                      {(profile.catalog.prompts ?? []).length} prompt
                      {(profile.catalog.prompts ?? []).length === 1 ? "" : "s"}
                    </span>
                    {profile.catalog.instructions?.trim() ? (
                      <>
                        <span>·</span>
                        <span>has server instructions</span>
                      </>
                    ) : null}
                  </div>

                  {approved.length > 0 ? (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Approved tools
                      </p>
                      <ul className="space-y-1 text-sm">
                        {approved.map((tool) => (
                          <li
                            key={tool.name}
                            className="flex items-center gap-2"
                          >
                            <span>
                              {tool.title || tool.name}
                              {!approvedNames.has(tool.name) ? (
                                <span className="text-muted-foreground">
                                  {" "}
                                  (catalog only)
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">
                      No approved tools yet — refresh and approve tools.
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={
                        !profile.runtimeSupported || refreshMut.isPending
                      }
                      onClick={() => {
                        if (!profile.runtimeSupported) {
                          toast.warning(
                            "This profile is unavailable in the current MCP runtime mode."
                          )
                          return
                        }
                        refreshMut.mutate({ id: profile.id })
                      }}
                    >
                      Refresh catalog
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(profile.id)
                        setForm(profileToForm(profile))
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={deleteMut.isPending}
                      onClick={() => {
                        if (
                          window.confirm(`Delete MCP server “${profile.name}”?`)
                        )
                          deleteMut.mutate({ id: profile.id })
                      }}
                    >
                      Delete
                    </Button>
                  </div>

                  {review ? (
                    <div className="mt-3 space-y-2 rounded-md bg-muted/30 p-3">
                      <p className="text-sm font-medium">Review tools</p>
                      {review.diff.removed.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Removed since last approve:{" "}
                          {review.diff.removed.join(", ")}
                        </p>
                      ) : null}
                      {review.catalog.tools.map((tool) => {
                        const badge = toolBadge(tool.name, review.diff)
                        return (
                          <label
                            key={tool.name}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Switch
                              checked={review.selected.includes(tool.name)}
                              onCheckedChange={(checked) =>
                                setPending((current) => ({
                                  ...current,
                                  [profile.id]: {
                                    ...review,
                                    selected: checked
                                      ? [...review.selected, tool.name]
                                      : review.selected.filter(
                                          (name) => name !== tool.name
                                        ),
                                  },
                                }))
                              }
                              size="sm"
                            />
                            <span>{tool.title || tool.name}</span>
                            {badge && badge !== "removed" ? (
                              <Badge variant="outline" className="text-[10px]">
                                {badge}
                              </Badge>
                            ) : null}
                          </label>
                        )
                      })}
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          approveMut.mutate({
                            id: profile.id,
                            toolAllowlist: review.selected,
                          })
                        }
                        disabled={approveMut.isPending}
                      >
                        Approve selected tools
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            }
          )}
          {profilesQuery.isSuccess && profilesQuery.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No MCP servers configured.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
