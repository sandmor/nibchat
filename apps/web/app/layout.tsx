import type { Metadata, Viewport } from "next"
import { Geist_Mono, Figtree } from "next/font/google"

import "@/styles/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TrpcProvider } from "@/components/trpc-provider"
import { cn } from "@/lib/utils"
import { Toaster } from "@/components/ui/sonner"

const figtree = Figtree({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

const siteDescription =
  "Highly customizable advanced AI chat. Branch-native conversations, with full control over messages and appearance."

function metadataBase(): URL {
  const raw = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  try {
    return new URL(raw)
  } catch {
    return new URL("http://localhost:3000")
  }
}

export const metadata: Metadata = {
  metadataBase: metadataBase(),
  title: {
    default: "Vero",
    template: "%s · Vero",
  },
  description: siteDescription,
  applicationName: "Vero",
  keywords: [
    "AI chat",
    "self-hosted",
    "conversation tree",
    "open source",
    "LLM",
  ],
  authors: [{ name: "Vero" }],
  creator: "Vero",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  // Single-owner private instances should not be indexed as public web pages.
  robots: {
    index: false,
    follow: false,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Vero",
    title: "Vero",
    description: siteDescription,
  },
  twitter: {
    card: "summary",
    title: "Vero",
    description: siteDescription,
  },
  appleWebApp: {
    title: "Vero",
    capable: true,
    statusBarStyle: "default",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        figtree.variable
      )}
    >
      <body>
        <ThemeProvider>
          <TrpcProvider>
            {children}
            <Toaster />
          </TrpcProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
