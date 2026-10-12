import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import express from "express";
import { config } from "./config.js";
import { db, channelForMember } from "./db.js";
import { requireAuth, signToken, publicUser, upsertUser, verifyGoogleCredential, backfillHandles, NAME_MAX } from "./auth.js";
import { setupRealtime, isOnline, voiceStatesForServer } from "./realtime.js";
import { registerSocialRoutes } from "./social.js";
import { registerAttachmentRoutes, attachmentsForMessages } from "./attachments.js";
import { APP_VERSION, clientDist } from "./version.js";
import { requestLogger, startHostStats } from "./hostStats.js";

const app = express();
const httpServer = http.createServer(app);
const io = setupRealtime(httpServer);
startHostStats(httpServer, io);

app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(requestLogger);

// Express 4 doesn't catch rejected promises from async handlers; this forwards them to the error handler.
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const cleanName = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

const serverDto = (s) => ({ id: s.id, name: s.name, ownerId: s.owner_id, inviteCode: s.invite_code });
const channelDto = (c) => ({ id: c.id, serverId: c.server_id, name: c.name, type: c.type });

const serverForMember = (serverId, userId) =>
  db.get("SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id WHERE s.id = ? AND m.user_id = ?", [
    String(serverId),
    userId,
  ]);

async function insertChannel(q, serverId, name, type) {
  const channel = { id: randomUUID(), server_id: serverId, name, type, created_at: Date.now() };
  await q.run("INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, ?, ?, ?, ?)", [
    channel.id,
    channel.server_id,
    channel.name,
    channel.type,
    channel.created_at,
  ]);
  return channel;
}

// ---------- Auth ----------

app.get("/api/config", (req, res) => {
  res.json({ googleClientId: config.googleClientId, devLogin: config.devLogin, iceServers: config.iceServers });
});

app.post(
  "/api/auth/google",
  route(async (req, res) => {
    const credential = req.body?.credential;
    if (typeof credential !== "string") return res.status(400).json({ error: "Missing Google credential" });

    let payload;
    try {
      payload = await verifyGoogleCredential(credential);
    } catch {
      return res.status(401).json({ error: "Google sign-in could not be verified" });
    }

    const user = await upsertUser({
      googleId: payload.sub,
      email: payload.email ?? null,
      username: cleanName(payload.name || payload.email?.split("@")[0] || "user", NAME_MAX),
      avatar: payload.picture ?? null,
      handleHint: payload.email?.split("@")[0],
    });
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

// Username-only login for local testing. Turned off in production unless DEV_LOGIN=true.
app.post(
  "/api/auth/dev",
  route(async (req, res) => {
    if (!config.devLogin) return res.status(404).json({ error: "Not found" });
    const username = cleanName(req.body?.username, NAME_MAX);
    if (!username) return res.status(400).json({ error: "Pick a username" });
    const user = await upsertUser({ googleId: `dev:${username.toLowerCase()}`, username });
    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

app.get("/api/me", requireAuth, (req, res) => res.json(publicUser(req.user)));

// Friends, direct messages and profile editing
registerSocialRoutes(app, io, route);

// ---------- Servers ----------

app.get(
  "/api/servers",
  requireAuth,
  route(async (req, res) => {
    const rows = await db.all(
      "SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id WHERE m.user_id = ? ORDER BY m.joined_at",
      [req.user.id]
    );
    res.json(rows.map(serverDto));
  })
);

app.post(
  "/api/servers",
  requireAuth,
  route(async (req, res) => {
    const name = cleanName(req.body?.name, 50);
    if (!name) return res.status(400).json({ error: "Server name is required" });

    const now = Date.now();
    const server = { id: randomUUID(), name, owner_id: req.user.id, invite_code: randomBytes(4).toString("hex") };
    await db.tx(async (q) => {
      await q.run("INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)", [
        server.id,
        server.name,
        server.owner_id,
        server.invite_code,
        now,
      ]);
      await q.run("INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?)", [
        server.id,
        req.user.id,
        now,
      ]);
      await insertChannel(q, server.id, "general", "text");
      await insertChannel(q, server.id, "General", "voice");
    });

    io.in(`user:${req.user.id}`).socketsJoin(`server:${server.id}`);
    res.status(201).json(serverDto(server));
  })
);

app.post(
  "/api/servers/join",
  requireAuth,
  route(async (req, res) => {
    const code = String(req.body?.inviteCode ?? "").trim().toLowerCase();
    const server = await db.get("SELECT * FROM servers WHERE invite_code = ?", [code]);
    if (!server) return res.status(404).json({ error: "That invite code doesn't exist" });

    const { changes } = await db.run(
      "INSERT INTO members (server_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
      [server.id, req.user.id, Date.now()]
    );

    io.in(`user:${req.user.id}`).socketsJoin(`server:${server.id}`);
    if (changes) {
      io.to(`server:${server.id}`).emit("member:joined", {
        serverId: server.id,
        member: { ...publicUser(req.user), online: isOnline(req.user.id) },
      });
    }
    res.json(serverDto(server));
  })
);

app.get(
  "/api/servers/:id",
  requireAuth,
  route(async (req, res) => {
    const server = await serverForMember(req.params.id, req.user.id);
    if (!server) return res.status(404).json({ error: "Server not found" });

    const channels = (
      await db.all("SELECT * FROM channels WHERE server_id = ? ORDER BY created_at, name", [server.id])
    ).map(channelDto);
    const members = (
      await db.all(
        `SELECT u.id, u.username, u.handle, u.avatar FROM users u
         JOIN members m ON m.user_id = u.id
         WHERE m.server_id = ? ORDER BY lower(u.username)`,
        [server.id]
      )
    ).map((u) => ({ ...u, online: isOnline(u.id) }));

    res.json({
      server: serverDto(server),
      channels,
      members,
      voiceStates: await voiceStatesForServer(server.id),
    });
  })
);

app.post(
  "/api/servers/:id/channels",
  requireAuth,
  route(async (req, res) => {
    const server = await serverForMember(req.params.id, req.user.id);
    if (!server) return res.status(404).json({ error: "Server not found" });
    if (server.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Only the server owner can create channels" });
    }

    const type = req.body?.type === "voice" ? "voice" : "text";
    let name = cleanName(req.body?.name, 32);
    if (type === "text") name = name.toLowerCase().replace(/\s+/g, "-");
    if (!name) return res.status(400).json({ error: "Channel name is required" });

    const channel = channelDto(await insertChannel(db, server.id, name, type));
    io.to(`server:${server.id}`).emit("channel:created", channel);
    res.status(201).json(channel);
  })
);

// ---------- Messages ----------

app.get(
  "/api/channels/:id/messages",
  requireAuth,
  route(async (req, res) => {
    const channel = await channelForMember(req.params.id, req.user.id);
    if (!channel) return res.status(404).json({ error: "Channel not found" });

    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = await db.all(
      `SELECT m.id, m.content, m.created_at, u.id AS author_id, u.username, u.avatar
       FROM messages m JOIN users u ON u.id = m.author_id
       WHERE m.channel_id = ? AND m.id < ?
       ORDER BY m.id DESC LIMIT 50`,
      [channel.id, before]
    );

    const attachments = await attachmentsForMessages(rows.map((r) => Number(r.id)));
    res.json(
      rows.reverse().map((r) => ({
        id: Number(r.id),
        channelId: channel.id,
        content: r.content,
        attachments: attachments[Number(r.id)] ?? [],
        createdAt: r.created_at,
        author: { id: r.author_id, username: r.username, avatar: r.avatar },
      }))
    );
  })
);

registerAttachmentRoutes(app, route);

// Which version of the app is deployed; open apps poll this to know when to refresh.
app.get("/api/version", (req, res) => {
  res.set("Cache-Control", "no-store").json({ version: APP_VERSION });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

// ---------- Serve the built React app ----------

if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        // index.html must always be re-checked so a refresh picks up a new deploy;
        // files in /assets have a content hash in their name, so they can be cached forever.
        if (filePath.endsWith(".html")) res.set("Cache-Control", "no-cache");
        else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.set("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.set("Cache-Control", "no-cache").sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") return res.status(413).json({ error: "That file is too big (10 MB max)" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

await backfillHandles();

httpServer.listen(config.port, config.host, () => {
  console.log(`Server running on http://localhost:${config.port} (database: ${db.kind})`);
  if (!config.googleClientId) console.log("GOOGLE_CLIENT_ID not set: Google login is hidden (dev login still works).");
});
