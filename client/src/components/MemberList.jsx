import Avatar from "./Avatar.jsx";

function Group({ title, members, ownerId, offline }) {
  if (!members.length) return null;
  return (
    <>
      <h3 className="section-title">{title}</h3>
      {members.map((m) => (
        <div key={m.id} className={`member ${offline ? "offline" : ""}`}>
          <Avatar user={m} size={32} status={m.online ? "online" : "offline"} />
          <span className="truncate">{m.username}</span>
          {m.id === ownerId && <span className="owner-tag" title="Server owner">owner</span>}
        </div>
      ))}
    </>
  );
}

export default function MemberList({ members, ownerId }) {
  const online = members.filter((m) => m.online);
  const offline = members.filter((m) => !m.online);
  return (
    <aside className="members" aria-label="Members">
      <Group title={`Online — ${online.length}`} members={online} ownerId={ownerId} />
      <Group title={`Offline — ${offline.length}`} members={offline} ownerId={ownerId} offline />
    </aside>
  );
}
