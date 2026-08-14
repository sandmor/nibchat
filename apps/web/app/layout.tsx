import type { Metadata, Viewport } from "next"
import { Geist_Mono, Figtree } from "next/font/google"

import "@/styles/globals.css"
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
    default: "Nibchat",
    template: "%s · Nibchat",
  },
  description: siteDescription,
  applicationName: "Nibchat",
  keywords: [
    "AI chat",
    "self-hosted",
    "conversation tree",
    "open source",
    "LLM",
  ],
  authors: [{ name: "Nibchat" }],
  creator: "Nibchat",
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
    siteName: "Nibchat",
    title: "Nibchat",
    description: siteDescription,
  },
  twitter: {
    card: "summary",
    title: "Nibchat",
    description: siteDescription,
  },
  appleWebApp: {
    title: "Nibchat",
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
        <TrpcProvider>
          {children}
          <Toaster />
        </TrpcProvider>
      </body>
    </html>
  )
}
