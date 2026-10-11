import Avatar from "./Avatar.jsx";
import ChatView from "./ChatView.jsx";
import { CallPanel } from "./VoiceView.jsx";
import { PhoneIcon, VideoIcon } from "./icons.jsx";

/** A direct message: header with call buttons, the call (when active), and the chat. */
export default function DMView({ dm, voice, chat, onCall }) {
  const inThisCall = voice.channel?.id === dm.id;
  const othersInCall = (dm.voice ?? []).length > 0;

  return (
    <div className="dm-view">
      <header className="content-header">
        <Avatar user={dm.user} size={26} status={dm.user.online ? "online" : "offline"} />
        <span className="truncate">{dm.user.username}</span>
        <span className="muted handle truncate">@{dm.user.handle}</span>
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
        </div>
      </header>

      {inThisCall ? (
        <div className="dm-call">
          <CallPanel voice={voice} />
        </div>
      ) : (
        othersInCall && (
          <div className="dm-call-banner">
            <PhoneIcon size={18} />
            <span>
              <strong>{dm.voice.map((p) => p.user.username).join(", ")}</strong> started a call.
            </span>
            <button className="btn success" onClick={() => onCall(dm, false)}>
              Join Call
            </button>
          </div>
        )
      )}

      <ChatView
        {...chat}
        channel={{ id: dm.id, name: dm.user.username }}
        showHeader={false}
        placeholder={`Message @${dm.user.handle}`}
        intro={
          <div className="channel-intro">
            <Avatar user={dm.user} size={80} />
            <h2>{dm.user.username}</h2>
            <p className="muted">
              This is the beginning of your direct message history with <strong>@{dm.user.handle}</strong>.
            </p>
          </div>
        }
      />
    </div>
  );
}
