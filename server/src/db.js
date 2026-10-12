// Database layer with two backends:
//   - DATABASE_URL set  -> PostgreSQL (used when hosted online, e.g. Neon)
//   - otherwise         -> SQLite file in server/data (local development)
//
// Queries are written once with "?" placeholders and work on both.
// Every function is async so the rest of the code doesn't care which backend is active.

import "./config.js"; // loads .env before DATABASE_URL is read

// Notes on the schema:
//   - users.username is the display name; users.handle is the unique @username used to add friends.
//   - A direct message is a channel with type 'dm', no server, and two rows in dm_members.
//     Its name is "<userIdA>:<userIdB>" (sorted) so there is only ever one DM per pair.
//   - A group DM is a channel with type 'group', no server, and up to 10 rows in dm_members.
//   - A friendship is stored as two rows in friends (one per direction).

const SQLITE_SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, google_id TEXT UNIQUE NOT NULL, email TEXT,
    username TEXT NOT NULL, handle TEXT UNIQUE, avatar TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
    invite_code TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS members (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (server_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('text', 'voice', 'dm', 'group')), created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dm_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);
  CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
  CREATE INDEX IF NOT EXISTS idx_dm_members_user ON dm_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_dm ON channels(name) WHERE type = 'dm';
`;

const POSTGRES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, google_id TEXT UNIQUE NOT NULL, email TEXT,
    username TEXT NOT NULL, avatar TEXT, created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
    invite_code TEXT UNIQUE NOT NULL, created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS members (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at BIGINT NOT NULL,
    PRIMARY KEY (server_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('text', 'voice')), created_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL, created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, id);
  CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);

  -- v2: usernames, friends, direct messages (safe to run on every start)
  ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
  ALTER TABLE channels ALTER COLUMN server_id DROP NOT NULL;
  ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_type_check;
  ALTER TABLE channels ADD CONSTRAINT channels_type_check CHECK (type IN ('text', 'voice', 'dm', 'group'));
  CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_dm ON channels(name) WHERE type = 'dm';
  CREATE TABLE IF NOT EXISTS dm_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_dm_members_user ON dm_members(user_id);
  CREATE TABLE IF NOT EXISTS friends (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );
  CREATE TABLE IF NOT EXISTS friend_requests (
    from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (from_id, to_id)
  );
  CREATE INDEX IF NOT EXISTS idx_friend_requests_to ON friend_requests(to_id);
`;

async function createSqlite() {
  const { DatabaseSync } = await import("node:sqlite");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new DatabaseSync(path.join(dataDir, "app.db"));
  sqlite.exec(SQLITE_SCHEMA);

  const q = {
    all: async (sql, params = []) => sqlite.prepare(sql).all(...params),
    get: async (sql, params = []) => sqlite.prepare(sql).get(...params) ?? null,
    run: async (sql, params = []) => ({ changes: Number(sqlite.prepare(sql).run(...params).changes) }),
  };
  return {
    kind: "sqlite",
    ...q,
    async tx(fn) {
      sqlite.exec("BEGIN");
      try {
        const result = await fn(q);
        sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

async function createPostgres(connectionString) {
  const { default: pg } = await import("pg");
  pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10)); // BIGINT -> number

  const pool = new pg.Pool({ connectionString, max: 5 });
  await pool.query(POSTGRES_SCHEMA);

  // "?" -> "$1, $2, ..." (none of our SQL has "?" inside string literals)
  const toPg = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  const makeQ = (client) => ({
    all: async (sql, params = []) => (await client.query(toPg(sql), params)).rows,
    get: async (sql, params = []) => (await client.query(toPg(sql), params)).rows[0] ?? null,
    run: async (sql, params = []) => ({ changes: (await client.query(toPg(sql), params)).rowCount }),
  });

  return {
    kind: "postgres",
    ...makeQ(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(makeQ(client));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export const db = process.env.DATABASE_URL ? await createPostgres(process.env.DATABASE_URL) : await createSqlite();

/** Returns the channel if `userId` can access it (member of its server, or part of the DM), else null. */
export function channelForMember(channelId, userId) {
  return db.get(
    `SELECT c.* FROM channels c
     WHERE c.id = ? AND (
       EXISTS (SELECT 1 FROM members m WHERE m.server_id = c.server_id AND m.user_id = ?)
       OR EXISTS (SELECT 1 FROM dm_members d WHERE d.channel_id = c.id AND d.user_id = ?)
     )`,
    [String(channelId), userId, userId]
  );
}

/** Socket.IO rooms that should receive events for a channel. */
export async function roomsForChannel(channel) {
  if (channel.server_id) return [`server:${channel.server_id}`];
  const rows = await db.all("SELECT user_id FROM dm_members WHERE channel_id = ?", [channel.id]);
  return rows.map((r) => `user:${r.user_id}`);
}
