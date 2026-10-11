import Avatar from "./Avatar.jsx";

function Group({ title, members, ownerId, offline, onMemberClick }) {
  if (!members.length) return null;
  return (
    <>
      <h3 className="section-title">{title}</h3>
      {members.map((m) => (
        <button key={m.id} className={`member ${offline ? "offline" : ""}`} onClick={() => onMemberClick(m)}>
          <Avatar user={m} size={32} status={m.online ? "online" : "offline"} />
          <span className="truncate">{m.username}</span>
          {m.id === ownerId && <span className="owner-tag" title="Server owner">owner</span>}
        </button>
      ))}
    </>
  );
}

export default function MemberList({ members, ownerId, onMemberClick }) {
  const online = members.filter((m) => m.online);
  const offline = members.filter((m) => !m.online);
  return (
    <aside className="members" aria-label="Members">
      <Group title={`Online — ${online.length}`} members={online} ownerId={ownerId} onMemberClick={onMemberClick} />
      <Group
        title={`Offline — ${offline.length}`}
        members={offline}
        ownerId={ownerId}
        onMemberClick={onMemberClick}
        offline
      />
    </aside>
  );
}
