import Avatar from "./Avatar.jsx";
import GroupAvatar from "./GroupAvatar.jsx";
import UserArea from "./UserArea.jsx";
import { UsersIcon, SpeakerIcon, PlusIcon } from "./icons.jsx";
import { dmTitle, isGroup } from "../dm.js";

/** Left sidebar of the Home screen: Friends + direct messages and group DMs. */
export default function HomeSidebar({ me, dms, homeView, unread, pendingCount, onSelect, onCreateGroup, userArea }) {
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
          <button className="icon-btn small" title="Create a group" aria-label="Create a group" onClick={onCreateGroup}>
            <PlusIcon size={14} />
          </button>
        </div>
        {dms.length === 0 && (
          <p className="muted small dm-empty">Message a friend, or press + to start a group call with several friends.</p>
        )}
        {dms.map((dm) => {
          const title = dmTitle(dm, me);
          return (
            <button
              key={dm.id}
              className={`dm-item ${homeView === dm.id ? "active" : ""} ${unread[dm.id] ? "unread" : ""}`}
              onClick={() => onSelect(dm.id)}
              title={title}
            >
              {isGroup(dm) ? (
                <GroupAvatar group={dm} size={32} />
              ) : (
                <Avatar user={dm.user} size={32} status={dm.user.online ? "online" : "offline"} />
              )}
              <span className="dm-item-text">
                <span className="truncate">{title}</span>
                {isGroup(dm) && <span className="muted small">{dm.members.length} members</span>}
              </span>
              {dm.voice?.length > 0 && (
                <span className="in-call" title="Call in progress">
                  <SpeakerIcon size={14} />
                </span>
              )}
              {unread[dm.id] > 0 && <span className="badge">{unread[dm.id]}</span>}
            </button>
          );
        })}
      </div>

      <UserArea {...userArea} />
    </aside>
  );
}
