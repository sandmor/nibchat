# Nibchat

Yet another AI Chat Platform.

Nibchat was created to give you two things: Full freedom to interact with LLMs, and a beautiful highly customizable interface for it.

Every AI chat client has features you love and features you hate. Here you choose what works for you.

## Features

- Appearance is handled through themes, defined through JSON (CSS vars, density, motion, optional remote stylesheet)
- Full user control
- Chats are trees, made from messages with sibling branches, path selection, and search across all branches. Our goal is maximum flexibility and non-destructive editing, though the alternative is also possible.
- No additional services required. SQLite by default; PostgreSQL is optional.
- Serverless support. Stateful default.
- Backup / restore (API keys excluded)

## Setup

```bash
pnpm install
cp .env.example .env
# set BETTER_AUTH_SECRET in .env (e.g. openssl rand -base64 32)
pnpm --filter web dev
```

Open [http://localhost:3000](http://localhost:3000). The first signup becomes the sole owner of the instance, then you can connect a model provider.

### Password reset

There is no outbound email for now. Generate a recovery link:

```bash
pnpm --filter web reset-password -- owner@example.com
```

Open the printed URL (or `/reset-password?token=…`).

## Environment

| Variable                    | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`        | Required in production                                              |
| `BETTER_AUTH_URL`           | Public origin (default `http://localhost:3000`)                     |
| `SQLITE_PATH`               | SQLite path relative to monorepo root (default `./data/nibchat.db`) |
| `DATABASE_URL`              | When set, selects the Postgres adapter instead of SQLite            |
| `DATABASE_POOL_SIZE`        | Postgres pool size (default `8`)                                    |
| `MCP_RUNTIME_MODE`          | `stateful` (default) or serverless-safe `stateless`                 |
| `GENERATION_RUNTIME_MODE`   | `stateful` (default) or `stateless` producer lifetime               |
| `GENERATION_STREAM_BACKEND` | `memory` (default) or shared `redis` stream storage                 |
| `REDIS_URL`                 | Redis for generation streams (`redis://` TCP or `https://` HTTP)    |
| `REDIS_TOKEN`               | Optional Bearer token for HTTP Redis                                |

Copy [`.env.example`](./.env.example) to `.env` and fill secrets. See [DEPLOYMENT.md](./DEPLOYMENT.md).

## Development

```bash
pnpm --filter web test        # vitest
pnpm --filter web test:e2e    # playwright
pnpm --filter web typecheck
```
