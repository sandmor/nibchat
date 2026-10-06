# Deploying Nibchat

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET (and optional BETTER_AUTH_URL) in .env
docker compose up --build
```

Compose and local app share the **repo-root** `.env`. Local development stores SQLite and filesystem attachments under **repo-root** `./data/`. Compose uses a Docker-managed `nibchat-data` volume by default, mounted at `/data`, so Docker does not create root-owned files in the checkout and its state is separate from `pnpm dev`.

Image attachments use filesystem storage by default (`./data/attachments` for local development and `/data/attachments` in Compose). Preserve the Docker volume or the whole `data/` directory, depending on which storage mode you use, for a manual backup. Set `ATTACHMENT_STORAGE=database` for serverless deployments or multiple app replicas that do not share a durable attachment volume.

Database engines are selected at process start by environment:

- **SQLite adapter** when `DATABASE_URL` is unset (default compose)
- **Postgres adapter** when `DATABASE_URL` is set:

```bash
# In .env:
# DATABASE_URL=postgres://nibchat:nibchat@postgres:5432/nibchat
docker compose --profile postgres up --build
```

The `postgres` profile starts Postgres (healthchecked). `nibchat` depends on it when the profile is active (`depends_on` with `required: false` for the SQLite path). Use hostname `postgres` from inside the Compose network.

Nibchat streams responses from its Route Handler. With nginx or another reverse proxy, disable response buffering for `/api/chat/stream` (for nginx: `proxy_buffering off`) and preserve streaming response bodies. The handler also sends `X-Accel-Buffering: no`.

## Ollama

Ollama stays an external service. In **Settings → Model providers**, choose
kind **Ollama**, then **Local** or **Cloud**. Nibchat discovers models from
that host; pull and manage them in Ollama.

Local leaves Base URL blank for `http://127.0.0.1:11434` and needs no key.
Cloud uses `https://ollama.com` plus a stored key, or an environment variable
such as `OLLAMA_API_KEY`.

Compose maps `host.docker.internal` to the Docker host. Use Base URL
`http://host.docker.internal:11434` for Ollama on that machine. On Linux, bind
Ollama beyond loopback (for example `OLLAMA_HOST=0.0.0.0:11434`) and restrict
the port to trusted networks.

Nibchat talks to Ollama from the server, not the browser. A daemon on a laptop
cannot serve a remote instance unless you expose it on a secured network.

Serverless deployments require PostgreSQL. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`; do not use the SQLite default path on ephemeral instances.

## Resumable generation streams

The default `GENERATION_RUNTIME_MODE=stateful` and
`GENERATION_STREAM_BACKEND=memory` need no additional service and work for one
long-lived Node process. For serverless or multiple replicas, set
`GENERATION_RUNTIME_MODE=stateless`, `GENERATION_STREAM_BACKEND=redis`, and
`REDIS_URL`. Redis retains active token events so another invocation can replay
them. It does not exceed the hosting platform's hard function duration: an
interrupted provider connection is finalized as an interrupted response.
Scheduled and recurrent sends use an in-process runner and are unavailable in
`stateless` mode; they require a long-lived Node process.

`REDIS_URL` selects the Redis transport: `redis://` or `rediss://` opens one
shared TCP connection; `http://` or `https://` POSTs each command as a JSON
array (`["XADD", …]`). HTTP Redis accepts an optional `{ result }` / `{ error }`
envelope. Set `REDIS_TOKEN` (or put the token in the URL userinfo) for Bearer
auth. Prefer HTTP Redis on serverless hosts that cannot hold extra TCP
connections.

## Activity history and server logs

Structured application logs are written to stdout as JSON. Collect and rotate
them through Docker or the hosting platform; Nibchat does not keep log files or
send logs to a third party. The Compose service uses Docker's rotating `local`
logging driver, and recent output remains available through `docker compose
logs nibchat`.

Activity history is stored in the configured application database. Owners set
its retention period, and users can clear their own history. It is excluded
from Nibchat's normal backup archives. Stateful deployments stream activity
snapshots while the Activity view is open. Stateless deployments load a
snapshot and support manual refresh; they do not keep a streaming request
open. A terminated serverless invocation
may leave an operation marked as running until authoritative generation or
schedule reconciliation can confirm interruption; elapsed time alone does not
mark it failed. Imports record each publish attempt rather than browser staging
sessions. PDF analysis-save entries measure persistence and display the submitted
analysis status, not browser processing time.

Set `LOG_LEVEL` to configure stdout logging; the default is `info`. Successful
ordinary API queries use `debug`; mutations and queries taking at least one second
use `info`. Expected request failures use `warn`, and internal failures use `error`.
Recurring polling and heartbeat failures are throttled per scope for 60 seconds;
the next emitted record includes the suppressed count. Operation records carry
safe correlation IDs, reasons, usage, and timings, never conversation text, tool
inputs/outputs, raw error messages, credentials, or request bodies.

For local Redis, enable the optional profile and set
`REDIS_URL=redis://redis:6379`:

```bash
docker compose --profile redis up --build
```

## MCP deployments

`MCP_RUNTIME_MODE=stateful` (the default) keeps one process-local connection per MCP profile and supports stdio, legacy SSE, and Streamable HTTP. Use it for the Docker deployment or another long-lived runtime.

For serverless or otherwise ephemeral instances, set `MCP_RUNTIME_MODE=stateless`. This accepts only external, modern v2 Streamable HTTP servers and opens a request-local connection for each tool call. Stdio, SSE, and automatic legacy fallback are intentionally rejected because they require durable process state.
