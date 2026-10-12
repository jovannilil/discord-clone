import Avatar from "./Avatar.jsx";
import GroupAvatar from "./GroupAvatar.jsx";
import ChatView from "./ChatView.jsx";
import { CallPanel } from "./VoiceView.jsx";
import { PhoneIcon, VideoIcon, UserPlusIcon, LogoutIcon } from "./icons.jsx";
import { dmTitle, isGroup } from "../dm.js";

/** A 1-on-1 DM or group DM: header with call buttons, the call (when active), the chat, and (for groups) members. */
export default function DMView({ dm, me, voice, chat, onCall, onAddPeople, onLeaveGroup }) {
  const group = isGroup(dm);
  const title = dmTitle(dm, me);
  const inThisCall = voice.channel?.id === dm.id;
  const othersInCall = (dm.voice ?? []).length > 0;

  return (
    <div className="dm-layout">
      <div className="dm-view">
        <header className="content-header">
          {group ? (
            <GroupAvatar group={dm} size={26} />
          ) : (
            <Avatar user={dm.user} size={26} status={dm.user.online ? "online" : "offline"} />
          )}
          <span className="truncate" title={title}>
            {title}
          </span>
          {!group && <span className="muted handle truncate">@{dm.user.handle}</span>}
          <div className="header-actions">
            <button
              className="icon-btn"
              title="Start voice call"
              aria-label="Start voice call"
              disabled={inThisCall}
              onClick={() => onCall(dm, false)}
            >
              <PhoneIcon size={20} />
            </button>
            <button
              className="icon-btn"
              title="Start video call"
              aria-label="Start video call"
              disabled={inThisCall}
              onClick={() => onCall(dm, true)}
            >
              <VideoIcon size={20} />
            </button>
            <button
              className="icon-btn"
              title={group ? "Add friends to this group" : "Add friends (makes a group)"}
              aria-label="Add people"
              onClick={() => onAddPeople(dm)}
            >
              <UserPlusIcon size={20} />
            </button>
            {group && (
              <button
                className="icon-btn"
                title="Leave group"
                aria-label="Leave group"
                onClick={() => onLeaveGroup(dm)}
              >
                <LogoutIcon size={20} />
              </button>
            )}
          </div>
        </header>

        {inThisCall ? (
          <div className="dm-call">
            <CallPanel voice={voice} onAddPeople={() => onAddPeople(dm)} />
          </div>
        ) : (
          othersInCall && (
            <div className="dm-call-banner">
              <PhoneIcon size={18} />
              <span>
                <strong>{dm.voice.map((p) => p.user.username).join(", ")}</strong>{" "}
                {dm.voice.length === 1 ? "is" : "are"} in a call.
              </span>
              <button className="btn success" onClick={() => onCall(dm, false)}>
                Join Call
              </button>
            </div>
          )
        )}

        <ChatView
          {...chat}
          channel={{ id: dm.id, name: title }}
          showHeader={false}
          placeholder={group ? `Message ${title}` : `Message @${dm.user.handle}`}
          intro={
            <div className="channel-intro">
              {group ? <GroupAvatar group={dm} size={80} /> : <Avatar user={dm.user} size={80} />}
              <h2>{title}</h2>
              <p className="muted">
                {group ? (
                  <>Welcome to the beginning of this group. Press the phone or camera button to call everyone.</>
                ) : (
                  <>
                    This is the beginning of your direct message history with <strong>@{dm.user.handle}</strong>.
                  </>
                )}
              </p>
            </div>
          }
        />
      </div>

      {group && (
        <aside className="members" aria-label="Group members">
          <h3 className="section-title">Members — {dm.members.length}</h3>
          {dm.members.map((m) => {
            const inCall = dm.voice?.some((p) => p.user.id === m.id);
            return (
              <div key={m.id} className={`member ${m.online || m.id === me.id ? "" : "offline"}`}>
                <Avatar user={m} size={32} status={m.online || m.id === me.id ? "online" : "offline"} />
                <span className="truncate" title={`${m.username} (@${m.handle})`}>
                  {m.username}
                </span>
                {inCall && (
                  <span className="in-call-tag" title="In the call">
                    <PhoneIcon size={12} />
                  </span>
                )}
              </div>
            );
          })}
        </aside>
      )}
    </div>
  );
}
