// Live numbers for the host dashboard (host/host.js).
//
// Only active when the dashboard started this server: it runs the server as a child process with
// an IPC channel (process.send). Every couple of seconds this sends how much CPU, memory and network
// the server is using, who is online and who is in a call. Requests and connections are sent as log lines.
// When the server runs any other way (npm run dev, a cloud host) all of this does nothing.

import { db } from "./db.js";
import { onlineUsers, activeCalls } from "./realtime.js";

const hosted = typeof process.send === "function";
const send = (msg) => {
  if (process.connected) process.send(msg);
};
const log = (level, text) => send({ type: "log", level, text });

// Express middleware: one log line per API request (except the version poll every open app makes).
export function requestLogger(req, res, next) {
  if (!hosted || !req.path.startsWith("/api/") || req.path === "/api/version") return next();
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const user = req.user ? ` (${req.user.username})` : "";
    log(res.statusCode >= 500 ? "error" : "http", `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms${user}`);
  });
  next();
}

async function databaseUsage() {
  const size =
    db.kind === "postgres"
      ? await db.get("SELECT pg_database_size(current_database()) AS bytes")
      : await db.get("SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()");
  const files = await db.get("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM attachments");
  const messages = await db.get("SELECT COUNT(*) AS n FROM messages");
  const users = await db.get("SELECT COUNT(*) AS n FROM users");
  return {
    kind: db.kind,
    bytes: Number(size.bytes),
    files: Number(files.n),
    fileBytes: Number(files.bytes),
    messages: Number(messages.n),
    users: Number(users.n),
  };
}

export function startHostStats(httpServer, io) {
  if (!hosted) return;

  // Network: every byte in and out of the server, including Socket.IO, counted per connection.
  let closedIn = 0;
  let closedOut = 0;
  const open = new Set();
  httpServer.on("connection", (socket) => {
    open.add(socket);
    socket.on("close", () => {
      closedIn += socket.bytesRead;
      closedOut += socket.bytesWritten;
      open.delete(socket);
    });
  });

  const events = {};
  io.on("connection", (socket) => {
    const name = socket.data.user?.username ?? "someone";
    log("info", `${name} connected`);
    socket.onAny((event) => (events[event] = (events[event] ?? 0) + 1));
    socket.on("disconnect", (reason) => log("info", `${name} disconnected (${reason})`));
  });

  let database = null;
  const refreshDatabase = () =>
    databaseUsage()
      .then((d) => (database = d))
      .catch((err) => log("error", `Couldn't read database size: ${err.message}`));
  refreshDatabase();
  setInterval(refreshDatabase, 60_000).unref();

  setInterval(() => {
    let bytesIn = closedIn;
    let bytesOut = closedOut;
    for (const s of open) {
      bytesIn += s.bytesRead;
      bytesOut += s.bytesWritten;
    }
    const mem = process.memoryUsage();
    send({
      type: "stats",
      cpu: process.cpuUsage(), // microseconds since start; the dashboard turns this into %
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      bytesIn,
      bytesOut,
      connections: io.engine.clientsCount,
      online: onlineUsers().map((u) => u.username),
      calls: activeCalls(),
      messagesSent: events["message:send"] ?? 0,
      database,
    });
  }, 2000).unref();
}
