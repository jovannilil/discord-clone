// File uploads (images, GIFs, videos, any file) attached to messages.
//
// Files are stored in the database itself, so they survive redeploys (the host's disk is wiped each deploy).
// Flow: the client uploads each file first (POST /api/channels/:id/attachments) and gets an id back,
// then sends the message with those ids; "message:send" links them to the new message.
// Download links use the random id as the key, like Discord's CDN, so <img> tags work without a login header.

import { randomUUID } from "node:crypto";
import express from "express";
import { db, channelForMember } from "./db.js";
import { requireAuth } from "./auth.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;
const UNSENT_TTL_MS = 60 * 60 * 1000; // uploads that never got sent are deleted after an hour

// Shown inside the app; everything else (html, svg, exe, ...) is always downloaded, never opened in the page.
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

const cleanFilename = (value) =>
  String(value ?? "")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .trim()
    .slice(0, 120) || "file";

export const attachmentDto = (a) => ({
  id: a.id,
  filename: a.filename,
  mime: a.mime,
  size: Number(a.size),
  url: `/api/attachments/${a.id}/${encodeURIComponent(a.filename)}`,
});

/** Attachments for a list of message ids, as { [messageId]: [attachment, ...] }. */
export async function attachmentsForMessages(messageIds) {
  if (messageIds.length === 0) return {};
  const rows = await db.all(
    `SELECT id, message_id, filename, mime, size FROM attachments
     WHERE message_id IN (${messageIds.map(() => "?").join(", ")})
     ORDER BY created_at, id`,
    messageIds
  );
  const byMessage = {};
  for (const r of rows) (byMessage[Number(r.message_id)] ??= []).push(attachmentDto(r));
  return byMessage;
}

/** The caller's own unsent uploads for this channel, out of `ids`. */
export async function findUnsentAttachments(q, ids, channelId, userId) {
  if (ids.length === 0) return [];
  return q.all(
    `SELECT id, filename, mime, size FROM attachments
     WHERE id IN (${ids.map(() => "?").join(", ")}) AND channel_id = ? AND uploader_id = ? AND message_id IS NULL
     ORDER BY created_at, id`,
    [...ids, channelId, userId]
  );
}

export function registerAttachmentRoutes(app, route) {
  // The file is the raw request body; its name and type come in headers.
  // (Sent as application/octet-stream so the global JSON parser leaves it alone.)
  app.post(
    "/api/channels/:id/attachments",
    requireAuth,
    express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
    route(async (req, res) => {
      const channel = await channelForMember(req.params.id, req.user.id);
      if (!channel || !["text", "dm", "group"].includes(channel.type)) {
        return res.status(404).json({ error: "Channel not found" });
      }
      const data = req.body;
      if (!Buffer.isBuffer(data) || data.length === 0) return res.status(400).json({ error: "The file is empty" });

      let filename;
      try {
        filename = cleanFilename(decodeURIComponent(req.get("X-File-Name") ?? ""));
      } catch {
        filename = "file";
      }
      const mime = String(req.get("X-File-Type") || "application/octet-stream").toLowerCase().slice(0, 100);
      const attachment = { id: randomUUID(), filename, mime, size: data.length };

      const now = Date.now();
      await db.run("DELETE FROM attachments WHERE message_id IS NULL AND created_at < ?", [now - UNSENT_TTL_MS]);
      await db.run(
        `INSERT INTO attachments (id, message_id, channel_id, uploader_id, filename, mime, size, data, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        [attachment.id, channel.id, req.user.id, filename, mime, data.length, data, now]
      );
      res.status(201).json(attachmentDto(attachment));
    })
  );

  app.get(
    "/api/attachments/:id/:name?",
    route(async (req, res) => {
      const a = await db.get("SELECT filename, mime, data FROM attachments WHERE id = ?", [String(req.params.id)]);
      if (!a) return res.status(404).json({ error: "File not found" });

      const inline = INLINE_TYPES.has(a.mime);
      const encoded = encodeURIComponent(a.filename);
      res.set({
        "Content-Type": inline ? a.mime : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
      res.end(Buffer.from(a.data));
    })
  );
}
