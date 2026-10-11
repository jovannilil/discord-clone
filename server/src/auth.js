import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { db } from "./db.js";
import { config } from "./config.js";

const googleClient = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;

export const publicUser = (u) => ({ id: u.id, username: u.username, avatar: u.avatar ?? null });

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

export async function upsertUser({ googleId, email = null, username, avatar = null }) {
  const existing = await db.get("SELECT * FROM users WHERE google_id = ?", [googleId]);
  if (existing) {
    await db.run("UPDATE users SET email = ?, avatar = ? WHERE id = ?", [email, avatar, existing.id]);
    return { ...existing, email, avatar };
  }
  const user = { id: randomUUID(), google_id: googleId, email, username, avatar, created_at: Date.now() };
  await db.run(
    "INSERT INTO users (id, google_id, email, username, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [user.id, user.google_id, user.email, user.username, user.avatar, user.created_at]
  );
  return user;
}
