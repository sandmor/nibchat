# Deploying Vero

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET (and optional BETTER_AUTH_URL) in .env
docker compose up --build
```

Compose and local app share the **repo-root** `.env`. SQLite is under **repo-root** `./data/` (default `./data/vero.db` locally; Docker bind-mounts that directory to `/data` with `SQLITE_PATH=/data/vero.db`).

Database engines are selected at process start by environment — never mixed:

- **SQLite adapter** when `DATABASE_URL` is unset (default compose)
- **Postgres adapter** when `DATABASE_URL` is set:

```bash
# In .env:
# DATABASE_URL=postgres://vero:vero@postgres:5432/vero
docker compose --profile postgres up --build
```

The `postgres` profile starts Postgres (healthchecked). `vero` depends on it when the profile is active (`depends_on` with `required: false` for the SQLite path). Use hostname `postgres` from inside the Compose network.

There is a single current schema (version 1). Older on-disk shapes are not upgraded in place; replace `./data` or the database for a clean install.

Vero streams responses from its Route Handler. With nginx or another reverse proxy, disable response buffering for `/api/chat/stream` (for nginx: `proxy_buffering off`) and preserve streaming response bodies. The handler also sends `X-Accel-Buffering: no`.

Serverless deployments require PostgreSQL. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`; do not use the SQLite default path on ephemeral instances.
