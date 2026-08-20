"use client"
import { useState } from "react"
import Link from "next/link"
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

export function AuthCard({ wrongAccount = false }: { wrongAccount?: boolean }) {
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  async function submit(form: FormData) {
    setLoading(true)
    setError("")
    const response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    })
    setLoading(false)
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      setError(data.message ?? data.error ?? "Could not authenticate")
    } else {
      window.location.assign("/")
    }
  }

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" })
    window.location.assign("/login")
  }

  return (
    <main className="grid min-h-svh place-items-center p-5">
      <Card className="w-full max-w-md shadow-[0_25px_80px_-35px_color-mix(in_oklab,var(--foreground),transparent_65%)]">
        <CardHeader>
          <Logo className="size-10" alt="" />
          <p className="text-xs font-semibold tracking-[.2em] text-primary uppercase">
            Nibchat / private AI workspace
          </p>
          <CardTitle className="text-3xl font-semibold tracking-tight">
            {wrongAccount ? "Not the instance owner" : "Welcome back."}
          </CardTitle>
          <CardDescription>
            {wrongAccount
              ? "This instance already has an owner. Sign out and sign in with that account, or contact whoever deployed Nibchat."
              : "Sign in to your self-hosted workspace."}
          </CardDescription>
        </CardHeader>
        {wrongAccount ? (
          <CardFooter className="flex flex-col gap-3">
            <Button className="w-full" onClick={signOut}>
              Sign out
            </Button>
          </CardFooter>
        ) : (
          <form action={submit} className="contents">
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  minLength={8}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button disabled={loading} className="w-full" type="submit">
                {loading ? "Working…" : "Sign in"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Forgot password? Open{" "}
                <Link
                  href="/reset-password"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  /reset-password
                </Link>{" "}
                with a token from{" "}
                <code className="rounded bg-muted px-1">
                  pnpm --filter web reset-password
                </code>
                .
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
    </main>
  )
}
