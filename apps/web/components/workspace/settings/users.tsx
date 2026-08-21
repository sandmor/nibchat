"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useTRPC } from "@/lib/trpc-react"

type ManagedUser = {
  id: string
  name: string
  email: string
  role?: string | null
  banned?: boolean | null
}

function isOwner(user: ManagedUser) {
  return user.role === "admin"
}

export function UsersSettings() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const users = useQuery(trpc.admin.listUsers.queryOptions())
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null)
  const [resetPassword, setResetPassword] = useState("")
  const [disableUser, setDisableUser] = useState<ManagedUser | null>(null)
  const [deleteUser, setDeleteUser] = useState<ManagedUser | null>(null)

  const listed = users.data ?? []
  const hasGuests = listed.some((user) => !isOwner(user))

  const create = useMutation(
    trpc.admin.createUser.mutationOptions({
      onSuccess: async () => {
        setName("")
        setEmail("")
        setPassword("")
        await queryClient.invalidateQueries(trpc.admin.listUsers.queryFilter())
        toast.success("User created")
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const reset = useMutation(
    trpc.admin.resetUserPassword.mutationOptions({
      onSuccess: () => {
        setResetUser(null)
        setResetPassword("")
        toast.success("Password reset and sessions revoked")
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const toggle = useMutation(
    trpc.admin.setUserDisabled.mutationOptions({
      onSuccess: async (_result, input) => {
        setDisableUser(null)
        await queryClient.invalidateQueries(trpc.admin.listUsers.queryFilter())
        toast.success(input.disabled ? "Account disabled" : "Account enabled")
      },
      onError: (error) => toast.error(error.message),
    })
  )
  const remove = useMutation(
    trpc.admin.deleteUser.mutationOptions({
      onSuccess: async () => {
        setDeleteUser(null)
        await queryClient.invalidateQueries(trpc.admin.listUsers.queryFilter())
        toast.success("User deleted")
      },
      onError: (error) => toast.error(error.message),
    })
  )

  const busyId =
    reset.variables?.userId ??
    toggle.variables?.userId ??
    remove.variables?.userId ??
    null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          Create and manage access to this instance. The owner remains the only
          administrator.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate({ name, email, password })
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="new-user-name">Name</Label>
            <Input
              id="new-user-name"
              value={name}
              autoComplete="off"
              disabled={create.isPending}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              type="email"
              value={email}
              autoComplete="off"
              disabled={create.isPending}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="new-user-password">Initial password</Label>
            <Input
              id="new-user-password"
              type="password"
              minLength={8}
              value={password}
              autoComplete="new-password"
              disabled={create.isPending}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </div>
        </form>
        <Separator />
        <div className="space-y-2">
          {users.isPending && !users.data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : null}
          {users.isError ? (
            <p className="text-sm text-destructive">Could not load users.</p>
          ) : null}
          {listed.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              busy={busyId === user.id}
              onReset={() => {
                setResetPassword("")
                setResetUser(user)
              }}
              onToggle={() => {
                if (user.banned) {
                  toggle.mutate({ userId: user.id, disabled: false })
                  return
                }
                setDisableUser(user)
              }}
              onDelete={() => setDeleteUser(user)}
            />
          ))}
          {listed.length > 0 && !hasGuests ? (
            <p className="text-sm text-muted-foreground">No other users yet.</p>
          ) : null}
        </div>
      </CardContent>

      <Dialog
        open={resetUser != null}
        onOpenChange={(open) => {
          if (open) return
          setResetUser(null)
          setResetPassword("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              {resetUser
                ? `${resetUser.name} will need this password to sign in. Their other sessions will be signed out.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="reset-user-password">New password</Label>
            <Input
              id="reset-user-password"
              type="password"
              minLength={8}
              value={resetPassword}
              autoComplete="new-password"
              disabled={reset.isPending}
              onChange={(event) => setResetPassword(event.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              disabled={resetPassword.length < 8 || reset.isPending}
              onClick={() => {
                if (!resetUser) return
                reset.mutate({
                  userId: resetUser.id,
                  password: resetPassword,
                })
              }}
            >
              {reset.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={disableUser != null}
        onOpenChange={(open) => {
          if (!open) setDisableUser(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable account?</AlertDialogTitle>
            <AlertDialogDescription>
              {disableUser
                ? `${disableUser.name} will not be able to sign in.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={toggle.isPending}
              onClick={() => {
                if (!disableUser) return
                toggle.mutate({ userId: disableUser.id, disabled: true })
              }}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteUser != null}
        onOpenChange={(open) => {
          if (!open) setDeleteUser(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUser
                ? `Delete “${deleteUser.email}”? This permanently removes their chats and files. This cannot be undone.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleteUser) return
                remove.mutate({ userId: deleteUser.id })
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function UserRow({
  user,
  busy,
  onReset,
  onToggle,
  onDelete,
}: {
  user: ManagedUser
  busy: boolean
  onReset: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const owner = isOwner(user)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-medium">{user.name}</span>
        {owner ? (
          <Badge variant="secondary" className="ml-2">
            Owner
          </Badge>
        ) : null}
        {user.banned ? (
          <Badge variant="outline" className="ml-2">
            Disabled
          </Badge>
        ) : null}
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
      {owner ? null : (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={busy} onClick={onReset}>
            Reset password
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onToggle}
          >
            {user.banned ? "Enable" : "Disable"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  )
}
