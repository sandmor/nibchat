"use client"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Logo } from "@/components/logo"

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-svh place-items-center">
          Loading recovery…
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  )
}

function ResetPasswordForm() {
  const params = useSearchParams()
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState("")
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const token = params.get("token")
    if (!token) return setStatus("This recovery link is incomplete.")
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: password }),
    })
    setStatus(
      response.ok
        ? "Password reset. You can now sign in."
        : "This link is invalid or expired."
    )
  }
  return (
    <main className="grid min-h-svh place-items-center p-5">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <Logo className="size-10" alt="" />
          <p className="text-xs font-semibold tracking-[.2em] text-primary uppercase">
            Nibchat recovery
          </p>
          <CardTitle className="text-3xl font-semibold tracking-tight">
            Set a new password
          </CardTitle>
          <CardDescription>
            Generate a recovery link with{" "}
            <code className="rounded bg-muted px-1 text-xs">
              pnpm --filter web reset-password
            </code>
            .
          </CardDescription>
        </CardHeader>
        <form onSubmit={submit} className="contents">
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                minLength={8}
                required
              />
            </div>
            {status && (
              <p className="text-sm text-muted-foreground">{status}</p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full">
              Reset password
            </Button>
            <Link
              href="/login"
              className="text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </Link>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
