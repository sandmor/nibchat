import type { Kysely } from "kysely"
import { sql } from "kysely"
import { appearanceToJson, defaultAppearance } from "@/lib/appearance"
import type { DbKind } from "@/lib/db/port"
import {
  DEFAULT_PROMPT_STACK_ID,
  defaultPromptStack,
  promptStackToJson,
} from "@/lib/prompt-stack"
import type { DB } from "@/lib/types"

/**
 * Apply the current schema (version 1). `kind` is available for
 * dialect-specific DDL when portable SQL is insufficient.
 */
export async function applySchema(db: Kysely<DB>, kind: DbKind) {
  void kind // reserved for dialect forks; DDL below is portable SQLite + Postgres

  await sql`create table if not exists "user" (id text primary key, name text not null, email text not null unique, "emailVerified" boolean not null default false, image text, "createdAt" text not null, "updatedAt" text not null)`.execute(
    db
  )
  await sql`create table if not exists session (id text primary key, "expiresAt" text not null, token text not null unique, "createdAt" text not null, "updatedAt" text not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user"(id) on delete cascade)`.execute(
    db
  )
  await sql`create table if not exists account (id text primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user"(id) on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" text, "refreshTokenExpiresAt" text, scope text, password text, "createdAt" text not null, "updatedAt" text not null)`.execute(
    db
  )
  await sql`create table if not exists verification (id text primary key, identifier text not null, value text not null, "expiresAt" text not null, "createdAt" text, "updatedAt" text)`.execute(
    db
  )
  await sql`create table if not exists prompt_stacks (id text primary key, name text not null, stack_json text not null, created_at text not null, updated_at text not null)`.execute(
    db
  )
  await sql`create table if not exists instance (id integer primary key, owner_user_id text unique, default_prompt_stack_id text not null, appearance_json text not null, created_at text not null)`.execute(
    db
  )
  await sql`create table if not exists chats (id text primary key, user_id text not null references "user"(id) on delete cascade, title text not null, selected_root_node_id text, model_config_json text not null, prompt_stack_id text, created_at text not null, updated_at text not null)`.execute(
    db
  )
  await sql`create table if not exists message_nodes (id text primary key, chat_id text not null references chats(id) on delete cascade, parent_id text references message_nodes(id) on delete cascade, selected_child_id text, role text not null, parts_json text not null, search_text text not null, metadata_json text not null, status text not null, created_at text not null, updated_at text not null)`.execute(
    db
  )
  await sql`create table if not exists provider_profiles (id text primary key, user_id text not null references "user"(id) on delete cascade, name text not null, kind text not null, base_url text, api_key text, api_key_env text, models_json text not null, created_at text not null, updated_at text not null)`.execute(
    db
  )
  await sql`create table if not exists model_catalog_cache (provider_id text primary key references provider_profiles(id) on delete cascade, models_json text not null, refreshed_at text not null)`.execute(
    db
  )
  await sql`create index if not exists message_nodes_chat_idx on message_nodes(chat_id, created_at)`.execute(
    db
  )
  await sql`create index if not exists message_nodes_search_idx on message_nodes(chat_id, search_text)`.execute(
    db
  )

  const seedAt = new Date().toISOString()
  await db
    .insertInto("prompt_stacks")
    .values({
      id: DEFAULT_PROMPT_STACK_ID,
      name: "Default",
      stack_json: promptStackToJson(defaultPromptStack()),
      created_at: seedAt,
      updated_at: seedAt,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute()

  await db
    .insertInto("instance")
    .values({
      id: 1,
      owner_user_id: null,
      default_prompt_stack_id: DEFAULT_PROMPT_STACK_ID,
      appearance_json: appearanceToJson(defaultAppearance(), false),
      created_at: seedAt,
    })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute()

  // Interrupted streams cannot be resumed across process restarts.
  await db
    .updateTable("message_nodes")
    .set({ status: "error", updated_at: new Date().toISOString() })
    .where("status", "=", "streaming")
    .execute()
}
