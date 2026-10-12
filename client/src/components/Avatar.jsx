const COLORS = ["#0f766e", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#00a8fc"];

const colorFor = (id = "") => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
};

export default function Avatar({ user, size = 32, status }) {
  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {user.avatar ? (
        <img src={user.avatar} alt="" referrerPolicy="no-referrer" />
      ) : (
        <div className="avatar-fallback" style={{ background: colorFor(user.id), fontSize: size * 0.42 }}>
          {user.username?.[0]?.toUpperCase() ?? "?"}
        </div>
      )}
      {status && <span className={`status-dot ${status}`} />}
    </div>
  );
}
