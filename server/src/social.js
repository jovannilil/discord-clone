// Friends, direct messages and profile editing.
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { requireAuth, publicUser, HANDLE_RE, NAME_MAX } from "./auth.js";
import { isOnline, voiceParticipants, setProfile } from "./realtime.js";

const USER_COLUMNS = "u.id, u.username, u.handle, u.avatar";
const withOnline = (u) => ({ ...publicUser(u), online: isOnline(u.id) });
const cleanHandle = (value) => String(value ?? "").trim().toLowerCase().replace(/^@/, "");

const areFriends = async (a, b) =>
  !!(await db.get("SELECT user_id FROM friends WHERE user_id = ? AND friend_id = ?", [a, b]));

const shareServer = async (a, b) =>
  !!(await db.get(
    "SELECT a.server_id FROM members a JOIN members b ON b.server_id = a.server_id WHERE a.user_id = ? AND b.user_id = ?",
    [a, b]
  ));

async function makeFriends(a, b) {
  const now = Date.now();
  await db.tx(async (q) => {
    await q.run("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", [a, b, b, a]);
    await q.run("INSERT INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", [a, b, now]);
    await q.run("INSERT INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", [b, a, now]);
  });
}

const GROUP_MAX = 10; // people per group DM / group call (calls connect everyone directly)

// Everyone you add must be your friend.
async function checkCanAdd(me, ids) {
  for (const id of ids) {
    const user = await db.get("SELECT id, username FROM users WHERE id = ?", [id]);
    if (!user) return "One of those people doesn't exist anymore";
    if (!(await areFriends(me, id))) return `You can only add friends (${user.username} isn't on your friends list)`;
  }
  return null;
}

/** Group DMs you're in (or just one, if `onlyId` is given), with their members. */
async function groupsFor(me, onlyId) {
  const groups = await db.all(
    `SELECT c.id, c.name, c.created_at,
       (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id) AS last_message_at
     FROM dm_members mine JOIN channels c ON c.id = mine.channel_id
     WHERE mine.user_id = ? AND c.type = 'group' ${onlyId ? "AND c.id = ?" : ""}`,
    onlyId ? [me, onlyId] : [me]
  );
  if (!groups.length) return [];
  const placeholders = groups.map(() => "?").join(", ");
  const members = await db.all(
    `SELECT d.channel_id, ${USER_COLUMNS} FROM dm_members d JOIN users u ON u.id = d.user_id
     WHERE d.channel_id IN (${placeholders}) ORDER BY lower(u.username)`,
    groups.map((g) => g.id)
  );
  return groups.map((g) => ({
    id: g.id,
    type: "group",
    name: g.name || "",
    members: members.filter((m) => m.channel_id === g.id).map(withOnline),
    lastMessageAt: g.last_message_at ?? g.created_at,
    voice: voiceParticipants(g.id),
  }));
}

const dmDto = (channel, otherUser, lastMessageAt) => ({
  id: channel.id,
  type: "dm",
  user: withOnline(otherUser),
  lastMessageAt: lastMessageAt ?? channel.created_at,
  voice: voiceParticipants(channel.id),
});

export function registerSocialRoutes(app, io, route) {
  // Tells both people's open apps to refresh their friends lists.
  const notifyFriendsChanged = (...userIds) => io.to(userIds.map((id) => `user:${id}`)).emit("friends:changed");

  // ---------- Profile ----------

  app.patch(
    "/api/me",
    requireAuth,
    route(async (req, res) => {
      const updates = {};
      if (req.body?.username !== undefined) {
        const name = String(req.body.username).trim().replace(/\s+/g, " ");
        if (!name) return res.status(400).json({ error: "Display name can't be empty" });
        if (name.length > NAME_MAX) {
          return res.status(400).json({ error: `Display names can be up to ${NAME_MAX} characters` });
        }
        updates.username = name;
      }
      if (req.body?.handle !== undefined) {
        const handle = cleanHandle(req.body.handle);
        if (!HANDLE_RE.test(handle)) {
          return res.status(400).json({ error: "Usernames are 2–25 characters: lowercase letters, numbers, _ and . only" });
        }
        const taken = await db.get("SELECT id FROM users WHERE handle = ? AND id <> ?", [handle, req.user.id]);
        if (taken) return res.status(409).json({ error: "That username is taken" });
        updates.handle = handle;
      }
      const keys = Object.keys(updates); // only "username" / "handle", never user input
      if (!keys.length) return res.status(400).json({ error: "Nothing to update" });

      await db.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [
        ...keys.map((k) => updates[k]),
        req.user.id,
      ]);
      const updated = { ...req.user, ...updates };
      setProfile(updated);
      res.json(publicUser(updated));
    })
  );

  // ---------- Friends ----------

  app.get(
    "/api/friends",
    requireAuth,
    route(async (req, res) => {
      const me = req.user.id;
      const friends = await db.all(
        `SELECT ${USER_COLUMNS} FROM friends f JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = ? ORDER BY lower(u.username)`,
        [me]
      );
      const incoming = await db.all(
        `SELECT ${USER_COLUMNS} FROM friend_requests r JOIN users u ON u.id = r.from_id
         WHERE r.to_id = ? ORDER BY r.created_at DESC`,
        [me]
      );
      const outgoing = await db.all(
        `SELECT ${USER_COLUMNS} FROM friend_requests r JOIN users u ON u.id = r.to_id
         WHERE r.from_id = ? ORDER BY r.created_at DESC`,
        [me]
      );
      res.json({
        friends: friends.map(withOnline),
        incoming: incoming.map(publicUser),
        outgoing: outgoing.map(publicUser),
      });
    })
  );

  // Send a friend request by @username. If they already asked you, you become friends right away.
  app.post(
    "/api/friends/requests",
    requireAuth,
    route(async (req, res) => {
      const me = req.user.id;
      const handle = cleanHandle(req.body?.handle);
      if (!handle) return res.status(400).json({ error: "Type a username" });

      const target = await db.get("SELECT * FROM users WHERE handle = ?", [handle]);
      if (!target) return res.status(404).json({ error: `Nobody has the username @${handle}. Check the spelling.` });
      if (target.id === me) return res.status(400).json({ error: "That's you!" });
      if (await areFriends(me, target.id)) {
        return res.status(409).json({ error: `You're already friends with @${target.handle}` });
      }

      const theyAskedFirst = await db.get("SELECT from_id FROM friend_requests WHERE from_id = ? AND to_id = ?", [
        target.id,
        me,
      ]);
      if (theyAskedFirst) {
        await makeFriends(me, target.id);
        notifyFriendsChanged(me, target.id);
        return res.json({ status: "accepted", user: publicUser(target) });
      }

      const { changes } = await db.run(
        "INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        [me, target.id, Date.now()]
      );
      if (!changes) return res.status(409).json({ error: `You already sent @${target.handle} a friend request` });

      notifyFriendsChanged(me, target.id);
      res.status(201).json({ status: "sent", user: publicUser(target) });
    })
  );

  app.post(
    "/api/friends/requests/:userId/accept",
    requireAuth,
    route(async (req, res) => {
      const me = req.user.id;
      const from = String(req.params.userId);
      const request = await db.get("SELECT from_id FROM friend_requests WHERE from_id = ? AND to_id = ?", [from, me]);
      if (!request) return res.status(404).json({ error: "That friend request doesn't exist anymore" });
      await makeFriends(me, from);
      notifyFriendsChanged(me, from);
      res.json({ ok: true });
    })
  );

  // Decline an incoming request or cancel one you sent.
  app.delete(
    "/api/friends/requests/:userId",
    requireAuth,
    route(async (req, res) => {
      const me = req.user.id;
      const other = String(req.params.userId);
      await db.run("DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", [
        me,
        other,
        other,
        me,
      ]);
      notifyFriendsChanged(me, other);
      res.json({ ok: true });
    })
  );

  app.delete(
    "/api/friends/:userId",
    requireAuth,
    route(async (req, res) => {
      const me = req.user.id;
      const other = String(req.params.userId);
      await db.run("DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)", [
        me,
        other,
        other,
        me,
      ]);
      notifyFriendsChanged(me, other);
      res.json({ ok: true });
    })
  );

  // ---------- Direct messages ----------

  app.get(
    "/api/dms",
    requireAuth,
    route(async (req, res) => {
      const rows = await db.all(
        `SELECT c.id, c.created_at, u.id AS uid, u.username, u.handle, u.avatar,
           (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = c.id) AS last_message_at
         FROM dm_members mine
         JOIN channels c ON c.id = mine.channel_id
         JOIN dm_members theirs ON theirs.channel_id = c.id AND theirs.user_id <> mine.user_id
         JOIN users u ON u.id = theirs.user_id
         WHERE mine.user_id = ? AND c.type = 'dm'`,
        [req.user.id]
      );
      const dms = rows.map((r) =>
        dmDto(r, { id: r.uid, username: r.username, handle: r.handle, avatar: r.avatar }, r.last_message_at)
      );
      const groups = await groupsFor(req.user.id);
      res.json([...dms, ...groups].sort((a, b) => b.lastMessageAt - a.lastMessageAt));
    })
  );

  // ---------- Group DMs (and group calls) ----------

  // Creates a group with you and the given friends. Used for "new group" and for
  // "add people" on a 1-on-1 DM (which turns it into a group, like Discord).
  app.post(
    "/api/groups",
    requireAuth,
    route(async (req, res) => {
      const me = req.user.id;
      const ids = [...new Set((req.body?.userIds ?? []).map(String))].filter((id) => id !== me);
      if (ids.length === 0) return res.status(400).json({ error: "Pick at least one friend" });
      if (ids.length + 1 > GROUP_MAX) return res.status(400).json({ error: `Groups can have up to ${GROUP_MAX} people` });
      const problem = await checkCanAdd(me, ids);
      if (problem) return res.status(403).json({ error: problem });

      const channel = { id: randomUUID(), created_at: Date.now() };
      await db.tx(async (q) => {
        await q.run("INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, NULL, '', 'group', ?)", [
          channel.id,
          channel.created_at,
        ]);
        for (const id of [me, ...ids]) {
          await q.run("INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?)", [channel.id, id]);
        }
      });
      io.to([me, ...ids].map((id) => `user:${id}`)).emit("dm:created", { channelId: channel.id });
      res.status(201).json((await groupsFor(me, channel.id))[0]);
    })
  );

  // Adds friends to an existing group. If a call is going on, they'll get a ringing popup.
  app.post(
    "/api/groups/:id/members",
    requireAuth,
    route(async (req, res) => {
      const me = req.user.id;
      const group = await db.get(
        `SELECT c.* FROM channels c JOIN dm_members d ON d.channel_id = c.id AND d.user_id = ?
         WHERE c.id = ? AND c.type = 'group'`,
        [me, String(req.params.id)]
      );
      if (!group) return res.status(404).json({ error: "Group not found" });

      const current = (await db.all("SELECT user_id FROM dm_members WHERE channel_id = ?", [group.id])).map(
        (r) => r.user_id
      );
      const ids = [...new Set((req.body?.userIds ?? []).map(String))].filter((id) => !current.includes(id));
      if (ids.length === 0) return res.status(400).json({ error: "Pick at least one friend to add" });
      if (current.length + ids.length > GROUP_MAX) {
        return res.status(400).json({ error: `Groups can have up to ${GROUP_MAX} people` });
      }
      const problem = await checkCanAdd(me, ids);
      if (problem) return res.status(403).json({ error: problem });

      for (const id of ids) {
        await db.run("INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING", [group.id, id]);
      }
      io.to([...current, ...ids].map((id) => `user:${id}`)).emit("dm:created", { channelId: group.id });
      res.json((await groupsFor(me, group.id))[0]);
    })
  );

  app.delete(
    "/api/groups/:id/members/me",
    requireAuth,
    route(async (req, res) => {
      const me = req.user.id;
      const groupId = String(req.params.id);
      const { changes } = await db.run(
        "DELETE FROM dm_members WHERE channel_id = ? AND user_id = ? AND channel_id IN (SELECT id FROM channels WHERE type = 'group')",
        [groupId, me]
      );
      if (!changes) return res.status(404).json({ error: "Group not found" });
      const left = await db.all("SELECT user_id FROM dm_members WHERE channel_id = ?", [groupId]);
      if (left.length === 0) await db.run("DELETE FROM channels WHERE id = ?", [groupId]);
      io.to([me, ...left.map((r) => r.user_id)].map((id) => `user:${id}`)).emit("dm:created", { channelId: groupId });
      res.json({ ok: true });
    })
  );

  // Opens (or creates) the DM with a user. Allowed with friends and people you share a server with.
  app.post(
    "/api/dms",
    requireAuth,
    route(async (req, res) => {
      const me = req.user.id;
      const other = await db.get("SELECT * FROM users WHERE id = ?", [String(req.body?.userId ?? "")]);
      if (!other || other.id === me) return res.status(404).json({ error: "User not found" });

      const name = [me, other.id].sort().join(":");
      let channel = await db.get("SELECT * FROM channels WHERE type = 'dm' AND name = ?", [name]);
      if (!channel) {
        if (!(await areFriends(me, other.id)) && !(await shareServer(me, other.id))) {
          return res.status(403).json({ error: "Add them as a friend first to send a message" });
        }
        channel = { id: randomUUID(), server_id: null, name, type: "dm", created_at: Date.now() };
        try {
          await db.tx(async (q) => {
            await q.run("INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, NULL, ?, 'dm', ?)", [
              channel.id,
              name,
              channel.created_at,
            ]);
            await q.run("INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?)", [channel.id, me]);
            await q.run("INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?)", [channel.id, other.id]);
          });
        } catch (err) {
          // Both people opened the DM at the same moment: use the one that won.
          channel = await db.get("SELECT * FROM channels WHERE type = 'dm' AND name = ?", [name]);
          if (!channel) throw err;
        }
        io.to([`user:${me}`, `user:${other.id}`]).emit("dm:created", { channelId: channel.id });
      }
      res.json(dmDto(channel, other));
    })
  );
}
