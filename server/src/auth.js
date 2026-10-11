import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { db } from "./db.js";
import { config } from "./config.js";

const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

export const publicUser = (u) => ({ id: u.id, username: u.username, handle: u.handle ?? null, avatar: u.avatar ?? null });

// ---------- Unique @usernames ("handles") ----------

export const HANDLE_RE = /^[a-z0-9_.]{2,32}$/;

export const normalizeHandle = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "")
    .slice(0, 32);

/** Turns a name or email into a free handle, adding numbers if it's taken: "jj moran" -> "jjmoran" or "jjmoran4821". */
export async function uniqueHandle(base) {
  let root = normalizeHandle(base).slice(0, 26);
  if (root.length < 2) root = "user";
  let candidate = root;
  for (let i = 0; i < 25; i++) {
    if (!(await db.get("SELECT id FROM users WHERE handle = ?", [candidate]))) return candidate;
    candidate = `${root}${Math.floor(1000 + Math.random() * 9000)}`;
  }
  return `${root}${Date.now().toString(36)}`;
}

/** Gives a handle to accounts created before handles existed. */
export async function backfillHandles() {
  const users = await db.all("SELECT id, email, username FROM users WHERE handle IS NULL");
  for (const u of users) {
    const handle = await uniqueHandle(u.email?.split("@")[0] || u.username);
    await db.run("UPDATE users SET handle = ? WHERE id = ?", [handle, u.id]);
  }
  if (users.length) console.log(`Gave usernames to ${users.length} existing account(s).`);
}

export const signToken = (user) => jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: "30d" });

export async function userFromToken(token) {
  if (typeof token !== "string") return null;
  let sub;
  try {
    ({ sub } = jwt.verify(token, config.jwtSecret));
  } catch {
    return null;
  }
  return db.get("SELECT * FROM users WHERE id = ?", [sub]);
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization ?? "";
    const user = header.startsWith("Bearer ") ? await userFromToken(header.slice(7)) : null;
    if (!user) return res.status(401).json({ error: "Not logged in" });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Verifies a Google ID token (from Google Identity Services) and returns its payload. */
export async function verifyGoogleCredential(credential) {
  if (!googleClient) throw new Error("Google login is not configured");
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });
  return ticket.getPayload();
}

export async function upsertUser({ googleId, email = null, username, avatar = null, handleHint }) {
  const existing = await db.get("SELECT * FROM users WHERE google_id = ?", [googleId]);
  if (existing) {
    await db.run("UPDATE users SET email = ?, avatar = ? WHERE id = ?", [email, avatar, existing.id]);
    return { ...existing, email, avatar };
  }
  const user = {
    id: randomUUID(),
    google_id: googleId,
    email,
    username,
    handle: await uniqueHandle(handleHint || username),
    avatar,
    created_at: Date.now(),
  };
  await db.run(
    "INSERT INTO users (id, google_id, email, username, handle, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [user.id, user.google_id, user.email, user.username, user.handle, user.avatar, user.created_at]
  );
  return user;
}
