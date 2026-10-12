import { UsersIcon } from "./icons.jsx";

const COLORS = ["#5865f2", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#00a8fc"];

/** Round icon for a group DM, colored from its id. */
export default function GroupAvatar({ group, size = 32 }) {
  let h = 0;
  for (const ch of group.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      <div className="avatar-fallback" style={{ background: COLORS[Math.abs(h) % COLORS.length] }}>
        <UsersIcon size={Math.round(size * 0.5)} />
      </div>
    </div>
  );
}
