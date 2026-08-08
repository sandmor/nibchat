# Vero

Vero is a highly customizable AI chat platform where you are in control of each aspect.

## Features

- Appearance is handled through themes, defined through JSON (CSS vars, density, motion, optional remote stylesheet)
- Full user control
- Chats are trees, made from messages with sibling branches, path selection, and search across all branches. Our goal is maximum flexibility and non-destructive editing, though the alternative is also possible.
- No additional services required. SQLite by default; PostgreSQL is optional.
- Backup / restore (API keys excluded)

## Current Limitations

- AI responses are kept alive by user clients; therefore, each tab is responsible for the request made within it, and if the tab closes or becomes unresponsive, the response is canceled.
- There is no replay of in-flight responses on new clients.

## Setup

```bash
pnpm install
cp .env.example .env
# set BETTER_AUTH_SECRET in .env (e.g. openssl rand -base64 32)
pnpm --filter web dev
```

Open [http://localhost:3000](http://localhost:3000). The first signup becomes the sole owner of the instance.

### Password reset

There is no outbound email for now. Generate a recovery link:

```bash
pnpm --filter web reset-password -- owner@example.com
```

Open the printed URL (or `/reset-password?token=…`).

## Environment

| Variable             | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | Required in production                                           |
| `BETTER_AUTH_URL`    | Public origin (default `http://localhost:3000`)                  |
| `SQLITE_PATH`        | SQLite path relative to monorepo root (default `./data/vero.db`) |
| `DATABASE_URL`       | When set, selects the Postgres adapter instead of SQLite         |
| `DATABASE_POOL_SIZE` | Postgres pool size (default `8`)                                 |

Copy [`.env.example`](./.env.example) to `.env` and fill secrets. See [DEPLOYMENT.md](./DEPLOYMENT.md).

## Development

```bash
pnpm --filter web test        # vitest
pnpm --filter web test:e2e    # playwright
pnpm --filter web typecheck
```
