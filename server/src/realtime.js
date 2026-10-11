import { Server } from "socket.io";
import { db, channelForMember, roomsForChannel } from "./db.js";
import { userFromToken, publicUser } from "./auth.js";

// Socket.IO rooms used:
//   user:<userId>      every socket of a user (DMs, friend updates, joining new server rooms)
//   server:<serverId>  every online member of a server (messages, presence, voice lists)
//   voice:<channelId>  sockets currently connected to a voice channel or DM call

const onlineCounts = new Map(); // userId -> number of open sockets
const voiceRooms = new Map(); // channelId -> Map<socketId, { socketId, user, muted, video }>

export const isOnline = (userId) => onlineCounts.has(userId);

export const voiceParticipants = (channelId) => [...(voiceRooms.get(channelId)?.values() ?? [])];

// Latest public profile per user, so a rename shows up immediately in new messages and calls.
const profiles = new Map();
export const setProfile = (user) => profiles.set(user.id, publicUser(user));

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

// Everyone who should see this user go online/offline: their servers and their friends.
const presenceRoomsFor = async (userId) => [
  ...(await serverRoomsFor(userId)),
  ...(await db.all("SELECT friend_id FROM friends WHERE user_id = ?", [userId])).map((r) => `user:${r.friend_id}`),
];

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
    setProfile(user);
    const me = () => profiles.get(user.id);

    // ---------- Voice / video (WebRTC signaling) ----------
    // Registered first and synchronously so no events are missed while the DB lookups below run.

    // rooms = the server's room for a voice channel, or both people's user rooms for a DM call.
    const emitVoiceState = ({ serverId, channelId, rooms }) => {
      io.to(rooms).emit("voice:state", { serverId, channelId, participants: voiceParticipants(channelId) });
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
        if (!channel || (channel.type !== "voice" && channel.type !== "dm")) {
          return reply({ error: "Voice channel not found" });
        }
        const rooms = await roomsForChannel(channel);

        leaveVoice();

        let room = voiceRooms.get(channel.id);
        if (!room) voiceRooms.set(channel.id, (room = new Map()));

        // The newcomer sends an offer to everyone already here.
        const peers = [...room.values()].map((p) => ({ socketId: p.socketId, user: p.user }));
        room.set(socket.id, { socketId: socket.id, user: me(), muted: muted === true, video: false });

        socket.data.voice = { channelId: channel.id, serverId: channel.server_id ?? null, rooms };
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
      io.to(to).emit("voice:signal", { from: socket.id, user: me(), data });
    });

    // ---------- Text chat ----------

    socket.on(
      "message:send",
      safe(async ({ channelId, content } = {}, ack) => {
        const reply = asAck(ack);
        const text = typeof content === "string" ? content.trim() : "";
        if (!text || text.length > 2000) return reply({ error: "Messages must be 1–2000 characters" });

        const channel = await channelForMember(channelId, user.id);
        if (!channel || (channel.type !== "text" && channel.type !== "dm")) {
          return reply({ error: "Channel not found" });
        }

        const createdAt = Date.now();
        const row = await db.get(
          "INSERT INTO messages (channel_id, author_id, content, created_at) VALUES (?, ?, ?, ?) RETURNING id",
          [channel.id, user.id, text, createdAt]
        );

        const message = {
          id: Number(row.id),
          channelId: channel.id,
          dm: channel.type === "dm",
          content: text,
          createdAt,
          author: me(),
        };
        io.to(await roomsForChannel(channel)).emit("message:new", message);
        reply({ ok: true });
      })
    );

    socket.on(
      "typing",
      safe(async ({ channelId } = {}) => {
        const channel = await channelForMember(channelId, user.id);
        if (channel) socket.to(await roomsForChannel(channel)).emit("typing", { channelId: channel.id, user: me() });
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
          const rooms = await presenceRoomsFor(user.id);
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
      if (count === 0) {
        const presenceRooms = await presenceRoomsFor(user.id);
        if (presenceRooms.length) io.to(presenceRooms).emit("presence", { userId: user.id, online: true });
      }
    } catch (err) {
      console.error("Failed to load rooms for socket:", err);
    }
  });

  return io;
}
