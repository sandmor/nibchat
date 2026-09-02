"use client"

import { useCallback, useId, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Logo } from "@/components/logo"
import { ProviderProfileFields } from "@/components/workspace/settings/provider-fields"
import { ProviderModelsEditor } from "@/components/workspace/settings/provider-models"
import { usePrefersReducedMotion } from "@/components/workspace/hooks"
import {
  defaultAppearance,
  motionTransition,
  shouldAnimate,
} from "@/lib/appearance"
import {
  PROVIDER_KINDS,
  asProviderKind,
  type ProviderKind,
} from "@/lib/provider-kinds"
import { isOllamaCloudUrl } from "@/lib/ollama"
import {
  catalogNameMap,
  defaultPdfInputForProviderKind,
  mergeCatalogWithSaved,
  modelsToPersist,
  parseProviderModelsJson,
  type CatalogModel,
  type ProviderModel,
} from "@/lib/provider-models"
import { useTRPC } from "@/lib/trpc-react"
import { cn } from "@/lib/utils"

type SetupStep = "owner" | "connect" | "models"

type SetupProvider = {
  id: string
  name: string
  kind: string
  base_url: string | null
  api_key_env: string | null
  models_json: string
}

export function SetupWizard({
  initialStep,
  initialProvider = null,
}: {
  initialStep: "owner" | "provider"
  initialProvider?: SetupProvider | null
}) {
  const [step, setStep] = useState<SetupStep>(
    initialStep === "owner" ? "owner" : initialProvider ? "models" : "connect"
  )
  const prefersReduced = usePrefersReducedMotion()
  const appearance = defaultAppearance()
  const animate = shouldAnimate(appearance.motion, prefersReduced)
  const transition = motionTransition(appearance.motion)

  return (
    <main className="grid min-h-svh place-items-center overflow-x-hidden p-5">
      <motion.div
        layout={animate}
        transition={transition}
        className={cn(
          "w-full overflow-hidden rounded-2xl bg-card text-card-foreground shadow-[0_25px_80px_-35px_color-mix(in_oklab,var(--foreground),transparent_65%)] ring-1 ring-foreground/8",
          step === "models" ? "max-w-2xl" : "max-w-xl"
        )}
      >
        <div className="flex flex-col gap-5 p-6 pb-0">
          <Logo className="size-10" alt="" />
          <p className="text-xs font-semibold tracking-[.2em] text-primary uppercase">
            Nibchat / private AI workspace
          </p>
          <SetupProgress
            step={step === "owner" ? 1 : step === "connect" ? 2 : 3}
            animate={animate}
            transition={transition}
          />
        </div>
        <div className="relative overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            {step === "owner" ? (
              <motion.div
                key="owner"
                custom={-1}
                variants={{
                  enter: (dir: number) =>
                    animate
                      ? { x: dir * 32, opacity: 0 }
                      : { x: 0, opacity: 1 },
                  center: { x: 0, opacity: 1 },
                  leave: (dir: number) =>
                    animate
                      ? { x: dir * -32, opacity: 0 }
                      : { x: 0, opacity: 1 },
                }}
                initial="enter"
                animate="center"
                exit="leave"
                transition={transition}
              >
                <OwnerStep onCreated={() => setStep("connect")} />
              </motion.div>
            ) : (
              <motion.div
                key="provider"
                custom={1}
                variants={{
                  enter: (dir: number) =>
                    animate
                      ? { x: dir * 32, opacity: 0 }
                      : { x: 0, opacity: 1 },
                  center: { x: 0, opacity: 1 },
                  leave: (dir: number) =>
                    animate
                      ? { x: dir * -32, opacity: 0 }
                      : { x: 0, opacity: 1 },
                }}
                initial="enter"
                animate="center"
                exit="leave"
                transition={transition}
              >
                <ProviderFlow
                  step={step}
                  initialProvider={initialProvider}
                  animate={animate}
                  transition={transition}
                  onStep={setStep}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </main>
  )
}

function SetupProgress({
  step,
  animate,
  transition,
}: {
  step: 1 | 2 | 3
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={step}
        aria-valuetext={`Step ${step} of 3`}
      >
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={false}
          animate={{ width: `${(step / 3) * 100}%` }}
          transition={animate ? transition : { duration: 0 }}
        />
      </div>
      <p className="text-xs font-medium text-muted-foreground tabular-nums">
        Step {step} of 3
      </p>
    </div>
  )
}

function OwnerStep({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function submit(form: FormData) {
    setLoading(true)
    setError("")
    const response = await fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
        name: form.get("name") || "Owner",
      }),
    })
    setLoading(false)
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      setError(data.message ?? data.error ?? "Could not create owner account")
      return
    }
    onCreated()
  }

  return (
    <form action={submit} className="flex flex-col gap-6 p-6">
      <header className="space-y-2">
        <h1
          tabIndex={-1}
          className="text-3xl font-semibold tracking-tight outline-none"
        >
          Make this yours.
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          The first account becomes this instance’s sole owner.
        </p>
      </header>
      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" autoComplete="name" required autoFocus />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <Button disabled={loading} className="w-full" type="submit">
        {loading ? "Working…" : "Create owner account"}
      </Button>
    </form>
  )
}

function ProviderFlow({
  step,
  initialProvider,
  animate,
  transition,
  onStep,
}: {
  step: "connect" | "models"
  initialProvider: SetupProvider | null
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
  onStep: (step: "connect" | "models") => void
}) {
  const trpc = useTRPC()
  const [kind, setKind] = useState<ProviderKind>(
    initialProvider ? asProviderKind(initialProvider.kind) : "openai"
  )
  const [name, setName] = useState(
    initialProvider?.name ?? PROVIDER_KINDS.openai.name
  )
  const [nameTouched, setNameTouched] = useState(Boolean(initialProvider))
  const [baseUrl, setBaseUrl] = useState(initialProvider?.base_url ?? "")
  const [apiKey, setApiKey] = useState("")
  const [apiKeyEnv, setApiKeyEnv] = useState(initialProvider?.api_key_env ?? "")
  const [clearApiKey, setClearApiKey] = useState(false)
  const [providerId, setProviderId] = useState(initialProvider?.id ?? "")
  const [models, setModels] = useState<ProviderModel[]>(() =>
    initialProvider ? parseProviderModelsJson(initialProvider.models_json) : []
  )
  const [catalog, setCatalog] = useState<CatalogModel[]>([])
  const [titleEnabled, setTitleEnabled] = useState(false)
  const [titleModel, setTitleModel] = useState("")
  const [error, setError] = useState("")
  const [catalogLoading, setCatalogLoading] = useState(step === "models")
  const displayName = nameTouched ? name : PROVIDER_KINDS[kind].name
  const enabledModels = models.filter((model) => model.enabled)
  const titleAvailable = enabledModels.length > 0
  const titleOn = titleEnabled && titleAvailable
  const selectedTitleModel = enabledModels.some(
    (model) => model.id === titleModel
  )
    ? titleModel
    : (enabledModels[0]?.id ?? "")

  const handleCatalogChange = useCallback(
    (next: CatalogModel[]) => {
      setCatalog(next)
      setModels((current) =>
        mergeCatalogWithSaved(
          current,
          next,
          defaultPdfInputForProviderKind(kind)
        )
      )
    },
    [kind]
  )

  const createProvider = useMutation(
    trpc.workspace.createProvider.mutationOptions()
  )
  const updateProvider = useMutation(
    trpc.workspace.updateProvider.mutationOptions()
  )
  const finish = useMutation(
    trpc.workspace.finishSetup.mutationOptions({
      onSuccess: () => window.location.assign("/"),
      onError: (err) => setError(err.message || "Could not finish setup"),
    })
  )
  const busy =
    finish.isPending || createProvider.isPending || updateProvider.isPending

  function connectPayload(includeKey: boolean) {
    return {
      name: displayName.trim(),
      kind,
      baseUrl: baseUrl.trim() || undefined,
      apiKey: includeKey ? apiKey.trim() || undefined : undefined,
      apiKeyEnv: apiKeyEnv.trim() || undefined,
      clearApiKey: clearApiKey || undefined,
      models: modelsToPersist(
        models,
        catalogNameMap(catalog),
        defaultPdfInputForProviderKind(kind),
        kind === "openai-compatible" || kind === "ollama"
      ),
    }
  }

  function validateConnect() {
    if (!displayName.trim()) return "Give this provider a display name."
    if (kind === "openai-compatible" && !baseUrl.trim())
      return "Compatible endpoints need a base URL."
    const needsKey =
      kind !== "openai-compatible" &&
      (kind !== "ollama" || isOllamaCloudUrl(baseUrl))
    if (needsKey && !providerId && !apiKey.trim() && !apiKeyEnv.trim())
      return "Add an API key or an environment variable name."
    return ""
  }

  async function loadModels() {
    const problem = validateConnect()
    if (problem) {
      setError(problem)
      return
    }
    setError("")
    const includeKey = Boolean(apiKey.trim())
    const payload = connectPayload(includeKey)
    try {
      let id = providerId
      if (id) {
        await updateProvider.mutateAsync({ id, ...payload })
      } else {
        const created = await createProvider.mutateAsync(payload)
        id = created.id
        setProviderId(id)
      }
      if (includeKey) setApiKey("")
      setCatalogLoading(true)
      onStep("models")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save provider")
    }
  }

  function skip() {
    setError("")
    finish.mutate(null)
  }

  function save() {
    if (!titleAvailable) {
      setError("Turn on at least one model, or skip for now.")
      return
    }
    setError("")
    finish.mutate({
      provider: {
        id: providerId || undefined,
        ...connectPayload(Boolean(apiKey.trim())),
      },
      titleModel: titleOn ? selectedTitleModel : undefined,
    })
  }

  if (step === "connect") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <header className="space-y-2">
          <h1
            tabIndex={-1}
            className="text-3xl font-semibold tracking-tight outline-none"
          >
            Connect a provider.
          </h1>
          <p className="text-sm text-pretty text-muted-foreground">
            We’ll load its catalog next so you can pick models by name.
          </p>
        </header>

        <ProviderProfileFields
          value={{
            name: displayName,
            kind,
            baseUrl,
            apiKey,
            apiKeyEnv,
            clearApiKey,
          }}
          onChange={(next) => {
            setKind(next.kind)
            setBaseUrl(next.baseUrl)
            setApiKey(next.apiKey)
            setApiKeyEnv(next.apiKeyEnv)
            setClearApiKey(Boolean(next.clearApiKey))
            if (next.kind !== kind && !nameTouched) {
              setName(PROVIDER_KINDS[next.kind].name)
              return
            }
            if (next.name !== displayName) setNameTouched(true)
            setName(next.name)
          }}
          kindUi="cards"
          existing={Boolean(providerId)}
          disabled={busy}
        />

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={skip}
          >
            Skip for now
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void loadModels()}
          >
            {createProvider.isPending || updateProvider.isPending
              ? "Loading models…"
              : "Load models"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="space-y-2">
        <h1
          tabIndex={-1}
          className="text-3xl font-semibold tracking-tight outline-none"
        >
          Choose models.
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          Turn on the models you want in chats.
        </p>
      </header>

      <ProviderModelsEditor
        providerId={providerId || null}
        providerKind={kind}
        models={models}
        catalog={catalog}
        defaultPdfInput={defaultPdfInputForProviderKind(kind)}
        onModelsChange={setModels}
        onCatalogChange={handleCatalogChange}
        onLoadingChange={setCatalogLoading}
        disabled={finish.isPending}
        refreshOnMount
        animate={animate}
        transition={transition}
      />

      <TitleModelSection
        enabled={titleOn}
        available={titleAvailable}
        model={selectedTitleModel}
        models={enabledModels}
        disabled={finish.isPending}
        animate={animate}
        transition={transition}
        onEnabledChange={setTitleEnabled}
        onModelChange={setTitleModel}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => onStep("connect")}
        >
          Back
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            disabled={finish.isPending}
            onClick={skip}
          >
            Skip for now
          </Button>
          <Button
            type="button"
            disabled={finish.isPending || catalogLoading}
            onClick={save}
          >
            {finish.isPending ? "Working…" : "Save and continue"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function TitleModelSection({
  enabled,
  available,
  model,
  models,
  disabled,
  animate,
  transition,
  onEnabledChange,
  onModelChange,
}: {
  enabled: boolean
  available: boolean
  model: string
  models: ProviderModel[]
  disabled: boolean
  animate: boolean
  transition: { duration: number; ease: [number, number, number, number] }
  onEnabledChange: (value: boolean) => void
  onModelChange: (value: string) => void
}) {
  const switchId = useId()
  const items = useMemo(
    () => Object.fromEntries(models.map((entry) => [entry.id, entry.label])),
    [models]
  )
  return (
    <section className="overflow-hidden rounded-2xl bg-muted/40 ring-1 ring-foreground/8">
      <div className="flex items-start gap-3 p-4">
        <Switch
          id={switchId}
          checked={enabled}
          disabled={disabled || !available}
          onCheckedChange={onEnabledChange}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <Label
            htmlFor={switchId}
            className={cn(
              "text-sm font-medium",
              !available && "text-muted-foreground"
            )}
          >
            Name chats automatically
          </Label>
          <p className="mt-1 text-xs text-pretty text-muted-foreground">
            {available
              ? "After the first reply, Nibchat can title the chat with this model. Leave this off to use the first message instead."
              : "Turn on a chat model above to use it for titles."}
          </p>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {enabled ? (
          <motion.div
            key="title-model"
            initial={animate ? { height: 0, opacity: 0 } : false}
            animate={{ height: "auto", opacity: 1 }}
            exit={animate ? { height: 0, opacity: 0 } : { height: 0 }}
            transition={transition}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-foreground/8 px-4 pt-3 pb-4">
              <Label htmlFor="title-model">Title model</Label>
              <Select
                value={model}
                items={items}
                onValueChange={(value) => {
                  if (value) onModelChange(value)
                }}
                disabled={disabled}
              >
                <SelectTrigger id="title-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  )
}
