# Nibchat

Nibchat is a self-hosted AI chat client. It exists to give you absolute control over the chat and the interaction: what the model sees, which reply you keep, whether an edit branches a message or replaces it, which tools it may call, and how the interface looks. Every client ships choices you want and choices you don't. Here you choose what works for you.

Chats are trees. Messages have sibling branches. You pick the path you want, return to a previous one, and search across every branch. You can exclude a message from context without deleting it, generate another child reply from any message, or edit and delete when you want the history changed. Spaces hold those chats and pass settings down. A setting in a space can stay a default, or you can require it (model, prompt stack, sampling, chat titles, appearance, context books) so every descendant uses what you set.

## Features

- Prompt stacks are ordered modules that build what the model receives, including where chat history sits. Prompt text expands dates, times, macros, and per-chat variables when you send. They provide a way to set the chrome of a conversation for a specific use case without you having to see it the whole time.
- Context books are notes you write ahead of time. When a keyword shows up in the conversation, the matching notes are inserted, so that piece of context arrives the same way every time.
- Chat templates save a whole conversation tree. New chats can start from one, and a space can set the default.
- OpenAI, Anthropic, and Ollama, plus OpenAI-compatible endpoints. You set reasoning effort per model in the chat. Unfamiliar endpoints need an explicit format in provider settings.
- Built-in tools, and MCP servers. You approve a tool once in settings, before the model can call it.
- Appearance is a JSON theme that you can visually edit: CSS variables, density, motion, and even an optional remote stylesheet. Spaces can select base themes and layer shared or light/dark overrides over them.
- Chat titles can use the first message or an enabled model. Admin, personal, and space settings can choose the title strategy, model, and instructions independently.
- Import ChatGPT exports, or SillyTavern archives. Character cards become spaces, with their chats and context books.
- Send or schedule several sibling replies from one prompt, or generate them beneath an existing message. Each reply streams and finishes independently.
- SQLite by default, PostgreSQL if you set `DATABASE_URL`. Backup and restore omit passwords and sessions. The first signup owns the instance and can add other users.

## Setup

Requires Node 20.16 or newer.

```bash
pnpm install
cp .env.example .env
# set BETTER_AUTH_SECRET in .env (e.g. openssl rand -base64 32)
pnpm --filter web dev
```

Open [http://localhost:3000](http://localhost:3000). Create the owner account, then connect a model provider.

For Docker Compose, Ollama on another host, and stateless or Redis-backed generation, see [DEPLOYMENT.md](./DEPLOYMENT.md). Compose stores its SQLite database and filesystem attachments in a Docker-managed `nibchat-data` volume, separate from the `./data/` directory used by local development.

### Password reset

There is no outbound email yet. Generate a recovery link:

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

Copy [`.env.example`](./.env.example) to `.env` and fill secrets.

## Development

```bash
pnpm --filter web test        # vitest
pnpm --filter web test:e2e    # playwright
pnpm --filter web typecheck
```
