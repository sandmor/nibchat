import { compileAppearance, type ThemeRecord } from "@/lib/appearance"

type SlotTheme = {
  id: string
  vars: Record<string, string>
  scheme: "light" | "dark"
  density: "comfortable" | "compact"
  motionEnabled: boolean
  motionReduced: string
}

function slotTheme(theme: ThemeRecord | undefined): SlotTheme | null {
  if (!theme) return null
  const document = theme.document
  return {
    id: theme.id,
    vars: compileAppearance(document),
    scheme: document.scheme,
    density: document.density,
    motionEnabled: document.motion.enabled,
    motionReduced: document.motion.reducedMotion,
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}

/**
 * Runs immediately after next-themes' slot script and before the workspace
 * shell. This prevents the assigned theme from flashing its Paper fallback.
 */
export function ThemeBootstrap({
  themes,
  lightThemeId,
  darkThemeId,
}: {
  themes: ThemeRecord[]
  lightThemeId: string
  darkThemeId: string
}) {
  const payload = {
    light: slotTheme(themes.find((theme) => theme.id === lightThemeId)),
    dark: slotTheme(themes.find((theme) => theme.id === darkThemeId)),
    ids: themes.map((theme) => theme.id),
  }
  const script = `(function(data){try{var root=document.documentElement;var slot=root.getAttribute("data-theme-slot")==="dark"?"dark":"light";var theme=data[slot]||data.light||data.dark;try{var saved=JSON.parse(localStorage.getItem("nibchat.appearance.magic")||"null");var preview=saved&&saved.v===2&&saved.open&&saved.preview;if(preview&&data.ids.indexOf(preview.themeId)>=0)theme={id:preview.themeId,vars:preview.vars,scheme:preview.scheme,density:preview.density,motionEnabled:preview.motionEnabled,motionReduced:preview.motionReduced}}catch(_){}if(!theme)return;Object.keys(theme.vars).forEach(function(key){if(key.slice(0,2)==="--")root.style.setProperty(key,theme.vars[key])});root.dataset.density=theme.density;root.dataset.motionEnabled=String(theme.motionEnabled);root.dataset.motionReduced=theme.motionReduced;root.classList.toggle("dark",theme.scheme==="dark");root.style.colorScheme=theme.scheme;root.dataset.nibchatThemeId=theme.id}catch(_){}})(${safeJson(payload)})`

  return (
    <script
      id="nibchat-theme-bootstrap"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: script }}
    />
  )
}
