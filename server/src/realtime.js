import { Server } from "socket.io";
import { db, channelForMember } from "./db.js";
import { userFromToken, publicUser } from "./auth.js";

// Socket.IO rooms used:
//   user:<userId>      every socket of a user (to add them to new server rooms)
//   server:<serverId>  every online member of a server (messages, presence, voice lists)
//   voice:<channelId>  sockets currently connected to a voice channel

const onlineCounts = new Map(); // userId -> number of open sockets
const voiceRooms = new Map(); // channelId -> Map<socketId, { socketId, user, muted, video }>

export const isOnline = (userId) => onlineCounts.has(userId);

export async function voiceStatesForServer(serverId) {
  const states = {};
  const channels = await db.all("SELECT id FROM channels WHERE server_id = ? AND type = 'voice'", [serverId]);
  for (const { id } of channels) {
    const room = voiceRooms.get(id);
    if (room?.size) states[id] = [...room.values()];
  }
  return states;
}

const serverRoomsFor = async (userId) =>
  (await db.all("SELECT server_id FROM members WHERE user_id = ?", [userId])).map((r) => `server:${r.server_id}`);

const asAck = (fn) => (typeof fn === "function" ? fn : () => {});

// Wraps an async socket handler so a database error is logged instead of crashing the process.
const safe =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error("Socket handler error:", err);
      const ack = args.at(-1);
      if (typeof ack === "function") ack({ error: "Server error" });
    }
  };

export function setupRealtime(httpServer) {
  const io = new Server(httpServer);

  io.use(async (socket, next) => {
    try {
      const user = await userFromToken(socket.handshake.auth?.token);
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = user;
      next();
    } catch (err) {
      next(new Error("server error"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user;
    const me = publicUser(user);

    // ---------- Voice / video (WebRTC signaling) ----------
    // Registered first and synchronously so no events are missed while the DB lookups below run.

    const emitVoiceState = ({ serverId, channelId }) => {
      const participants = [...(voiceRooms.get(channelId)?.values() ?? [])];
      io.to(`server:${serverId}`).emit("voice:state", { serverId, channelId, participants });
    };

    const leaveVoice = () => {
      const current = socket.data.voice;
      if (!current) return;
      socket.data.voice = null;

      const room = voiceRooms.get(current.channelId);
      room?.delete(socket.id);
      if (room && room.size === 0) voiceRooms.delete(current.channelId);

      socket.leave(`voice:${current.channelId}`);
      io.to(`voice:${current.channelId}`).emit("voice:peer-left", { socketId: socket.id });
      emitVoiceState(current);
    };

    socket.on(
      "voice:join",
      safe(async ({ channelId, muted } = {}, ack) => {
        const reply = asAck(ack);
        const channel = await channelForMember(channelId, user.id);
        if (!channel || channel.type !== "voice") return reply({ error: "Voice channel not found" });

        leaveVoice();

        let room = voiceRooms.get(channel.id);
        if (!room) voiceRooms.set(channel.id, (room = new Map()));

        // The newcomer sends an offer to everyone already here.
        const peers = [...room.values()].map((p) => ({ socketId: p.socketId, user: p.user }));
        room.set(socket.id, { socketId: socket.id, user: me, muted: muted === true, video: false });

        socket.data.voice = { channelId: channel.id, serverId: channel.server_id };
        socket.join(`voice:${channel.id}`);

        reply({ ok: true, peers, participants: [...room.values()] });
        emitVoiceState(socket.data.voice);
      })
    );

    socket.on("voice:leave", leaveVoice);

    socket.on("voice:update", ({ muted, video } = {}) => {
      const current = socket.data.voice;
      const self = current && voiceRooms.get(current.channelId)?.get(socket.id);
      if (!self) return;
      if (typeof muted === "boolean") self.muted = muted;
      if (typeof video === "boolean") self.video = video;
      emitVoiceState(current);
    });

    // Relays offers / answers / ICE candidates between two sockets in the same voice channel.
    socket.on("voice:signal", ({ to, data } = {}) => {
      const current = socket.data.voice;
      if (!current || typeof to !== "string" || !voiceRooms.get(current.channelId)?.has(to)) return;
      io.to(to).emit("voice:signal", { from: socket.id, user: me, data });
    });

    // ---------- Text chat ----------

    socket.on(
      "message:send",
      safe(async ({ channelId, content } = {}, ack) => {
        const reply = asAck(ack);
        const text = typeof content === "string" ? content.trim() : "";
        if (!text || text.length > 2000) return reply({ error: "Messages must be 1–2000 characters" });

        const channel = await channelForMember(channelId, user.id);
        if (!channel || channel.type !== "text") return reply({ error: "Channel not found" });

        const createdAt = Date.now();
        const row = await db.get(
          "INSERT INTO messages (channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?) RETURNING id",
          [channel.id, user.id, text, createdAt]
        );

        const message = { id: Number(row.id), channelId: channel.id, content: text, createdAt, author: me };
        io.to(`server:${channel.server_id}`).emit("message:new", message);
        reply({ ok: true });
      })
    );

    socket.on(
      "typing",
      safe(async ({ channelId } = {}) => {
        const channel = await channelForMember(channelId, user.id);
        if (channel) socket.to(`server:${channel.server_id}`).emit("typing", { channelId: channel.id, user: me });
      })
    );

    // ---------- Disconnect ----------

    socket.on(
      "disconnect",
      safe(async () => {
        leaveVoice();
        const remaining = (onlineCounts.get(user.id) ?? 1) - 1;
        if (remaining > 0) {
          onlineCounts.set(user.id, remaining);
        } else {
          onlineCounts.delete(user.id);
          const rooms = await serverRoomsFor(user.id);
          if (rooms.length) io.to(rooms).emit("presence", { userId: user.id, online: false });
        }
      })
    );

    // ---------- Join rooms + announce presence ----------

    socket.join(`user:${user.id}`);
    const count = onlineCounts.get(user.id) ?? 0;
    onlineCounts.set(user.id, count + 1);
    try {
      const rooms = await serverRoomsFor(user.id);
      if (rooms.length) socket.join(rooms);
      if (count === 0 && rooms.length) io.to(rooms).emit("presence", { userId: user.id, online: true });
    } catch (err) {
      console.error("Failed to load rooms for socket:", err);
    }
  });

  return io;
}
