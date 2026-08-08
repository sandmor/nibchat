import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Reset password",
  description:
    "Set a new password for your Vero instance owner account using a recovery link.",
  robots: {
    index: false,
    follow: false,
  },
}

export default function ResetPasswordLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return children
}
