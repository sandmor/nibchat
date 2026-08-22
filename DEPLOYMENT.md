# Deploying Nibchat

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET (and optional BETTER_AUTH_URL) in .env
docker compose up --build
```

Compose and local app share the **repo-root** `.env`. SQLite is under **repo-root** `./data/` (default `./data/nibchat.db` locally; Docker bind-mounts that directory to `/data` with `SQLITE_PATH=/data/nibchat.db`).

Image attachments use filesystem storage by default (`./data/attachments`, or
`/data/attachments` in Compose). Preserve the whole `data/` directory for a
manual backup. Set `ATTACHMENT_STORAGE=database` for serverless deployments or
multiple app replicas that do not share a durable attachment volume.

Database engines are selected at process start by environment — never mixed:

- **SQLite adapter** when `DATABASE_URL` is unset (default compose)
- **Postgres adapter** when `DATABASE_URL` is set:

```bash
# In .env:
# DATABASE_URL=postgres://nibchat:nibchat@postgres:5432/nibchat
docker compose --profile postgres up --build
```

The `postgres` profile starts Postgres (healthchecked). `nibchat` depends on it when the profile is active (`depends_on` with `required: false` for the SQLite path). Use hostname `postgres` from inside the Compose network.

Nibchat streams responses from its Route Handler. With nginx or another reverse proxy, disable response buffering for `/api/chat/stream` (for nginx: `proxy_buffering off`) and preserve streaming response bodies. The handler also sends `X-Accel-Buffering: no`.

Serverless deployments require PostgreSQL. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`; do not use the SQLite default path on ephemeral instances.

## Resumable generation streams

The default `GENERATION_RUNTIME_MODE=stateful` and
`GENERATION_STREAM_BACKEND=memory` need no additional service and work for one
long-lived Node process. For serverless or multiple replicas, set
`GENERATION_RUNTIME_MODE=stateless`, `GENERATION_STREAM_BACKEND=redis`, and
`REDIS_URL`. Redis retains active token events so another invocation can replay
them. It does not exceed the hosting platform's hard function duration: an
interrupted provider connection is finalized as an interrupted response.

`REDIS_URL` selects the Redis transport: `redis://` or `rediss://` opens one
shared TCP connection; `http://` or `https://` POSTs each command as a JSON
array (`["XADD", …]`). HTTP Redis accepts an optional `{ result }` / `{ error }`
envelope. Set `REDIS_TOKEN` (or put the token in the URL userinfo) for Bearer
auth. Prefer HTTP Redis on serverless hosts that cannot hold extra TCP
connections.

For local Redis, enable the optional profile and set
`REDIS_URL=redis://redis:6379`:

```bash
docker compose --profile redis up --build
```

## MCP deployments

`MCP_RUNTIME_MODE=stateful` (the default) keeps one process-local connection per MCP profile and supports stdio, legacy SSE, and Streamable HTTP. Use it for the Docker deployment or another long-lived runtime.

For serverless or otherwise ephemeral instances, set `MCP_RUNTIME_MODE=stateless`. This accepts only external, modern v2 Streamable HTTP servers and opens a request-local connection for each tool call. Stdio, SSE, and automatic legacy fallback are intentionally rejected because they require durable process state.
