import Avatar from "./Avatar.jsx";
import UserArea from "./UserArea.jsx";
import { UsersIcon, SpeakerIcon } from "./icons.jsx";

/** Left sidebar of the Home screen: Friends + direct messages. */
export default function HomeSidebar({ dms, homeView, unread, pendingCount, onSelect, userArea }) {
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <span className="truncate">Home</span>
      </header>

      <div className="channel-list">
        <button className={`channel big ${homeView === "friends" ? "active" : ""}`} onClick={() => onSelect("friends")}>
          <UsersIcon size={20} />
          <span className="truncate">Friends</span>
          {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
        </button>

        <div className="section-row">
          <h3 className="section-title">Direct Messages</h3>
        </div>
        {dms.length === 0 && <p className="muted small dm-empty">Message a friend and your conversation will show up here.</p>}
        {dms.map((dm) => (
          <button
            key={dm.id}
            className={`dm-item ${homeView === dm.id ? "active" : ""} ${unread[dm.id] ? "unread" : ""}`}
            onClick={() => onSelect(dm.id)}
          >
            <Avatar user={dm.user} size={32} status={dm.user.online ? "online" : "offline"} />
            <span className="truncate">{dm.user.username}</span>
            {dm.voice?.length > 0 && (
              <span className="in-call" title="In a call">
                <SpeakerIcon size={14} />
              </span>
            )}
            {unread[dm.id] > 0 && <span className="badge">{unread[dm.id]}</span>}
          </button>
        ))}
      </div>

      <UserArea {...userArea} />
    </aside>
  );
}
