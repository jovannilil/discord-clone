// Helpers for 1-on-1 DMs ({ type: "dm", user }) and group DMs ({ type: "group", members, name }).

export const NAME_MAX = 25; // must match the server (auth.js)
export const GROUP_MAX = 10; // must match the server (social.js)

export const isGroup = (dm) => dm?.type === "group";

/** Everyone in the conversation except you. */
export const dmOthers = (dm, me) => (isGroup(dm) ? dm.members.filter((m) => m.id !== me.id) : [dm.user]);

/** What to call the conversation: the friend's name, or the group's member names. */
export function dmTitle(dm, me) {
  if (!isGroup(dm)) return dm.user.username;
  if (dm.name) return dm.name;
  const others = dmOthers(dm, me);
  return others.length ? others.map((m) => m.username).join(", ") : "Empty group";
}
