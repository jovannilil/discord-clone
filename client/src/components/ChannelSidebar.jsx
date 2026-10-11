import { useState } from "react";
import Avatar from "./Avatar.jsx";
import UserArea from "./UserArea.jsx";
import { HashIcon, SpeakerIcon, MicOffIcon, PlusIcon } from "./icons.jsx";

function SectionTitle({ title, onAdd }) {
  return (
    <div className="section-row">
      <h3 className="section-title">{title}</h3>
      {onAdd && (
        <button className="icon-btn small" title="Create channel" onClick={onAdd}>
          <PlusIcon size={14} />
        </button>
      )}
    </div>
  );
}

export default function ChannelSidebar({ data, user, activeChannelId, onSelect, onCreateChannel, userArea }) {
  const { server, channels, voiceStates } = data;
  const isOwner = server.ownerId === user.id;
  const [copied, setCopied] = useState(false);

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");
  const voiceChannelId = userArea.voice.channel?.id;

  function copyInvite() {
    navigator.clipboard
      ?.writeText(server.inviteCode)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <span className="truncate">{server.name}</span>
      </header>

      <div className="channel-list">
        <button className="invite-row" onClick={copyInvite} title="Copy invite code">
          <span className="muted small">Invite code</span>
          <code>{copied ? "Copied!" : server.inviteCode}</code>
        </button>

        <SectionTitle title="Text Channels" onAdd={isOwner ? () => onCreateChannel("text") : null} />
        {textChannels.map((c) => (
          <button
            key={c.id}
            className={`channel ${c.id === activeChannelId ? "active" : ""}`}
            onClick={() => onSelect(c)}
          >
            <HashIcon size={18} />
            <span className="truncate">{c.name}</span>
          </button>
        ))}

        <SectionTitle title="Voice Channels" onAdd={isOwner ? () => onCreateChannel("voice") : null} />
        {voiceChannels.map((c) => (
          <div key={c.id}>
            <button
              className={`channel ${c.id === activeChannelId ? "active" : ""} ${voiceChannelId === c.id ? "connected" : ""}`}
              onClick={() => onSelect(c)}
            >
              <SpeakerIcon size={18} />
              <span className="truncate">{c.name}</span>
            </button>
            {(voiceStates[c.id] ?? []).map((p) => (
              <div key={p.socketId} className="voice-user">
                <Avatar user={p.user} size={22} />
                <span className="truncate">{p.user.username}</span>
                {p.video && <span className="live-tag">LIVE</span>}
                {p.muted && (
                  <span className="muted" title="Muted">
                    <MicOffIcon size={14} />
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <UserArea {...userArea} />
    </aside>
  );
}
