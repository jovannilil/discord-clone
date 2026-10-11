import { useState } from "react";
import Avatar from "./Avatar.jsx";
import {
  HashIcon,
  SpeakerIcon,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
  ScreenIcon,
  PhoneOffIcon,
  LogoutIcon,
  PlusIcon,
} from "./icons.jsx";

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

function VoicePanel({ voice }) {
  return (
    <div className="voice-panel">
      <div className="voice-panel-top">
        <div className="truncate">
          <div className="voice-connected">Voice Connected</div>
          <div className="muted small truncate">
            {voice.channel.name} / {voice.channel.serverName}
          </div>
        </div>
        <button className="icon-btn danger" title="Disconnect" onClick={voice.leave}>
          <PhoneOffIcon size={18} />
        </button>
      </div>
      <div className="voice-panel-actions">
        <button
          className={`panel-btn ${voice.videoMode === "camera" ? "on" : ""}`}
          title={voice.videoMode === "camera" ? "Turn off camera" : "Turn on camera"}
          onClick={voice.toggleCamera}
        >
          {voice.videoMode === "camera" ? <VideoIcon /> : <VideoOffIcon />}
        </button>
        <button
          className={`panel-btn ${voice.videoMode === "screen" ? "on" : ""}`}
          title={voice.videoMode === "screen" ? "Stop sharing" : "Share your screen"}
          onClick={voice.toggleScreen}
        >
          <ScreenIcon />
        </button>
      </div>
      {voice.error && (
        <div className="voice-error" onClick={voice.clearError} title="Dismiss">
          {voice.error}
        </div>
      )}
    </div>
  );
}

export default function ChannelSidebar({ data, user, activeChannelId, onSelect, onCreateChannel, voice, onLogout, connected }) {
  const { server, channels, voiceStates } = data;
  const isOwner = server.ownerId === user.id;
  const [copied, setCopied] = useState(false);

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

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
              className={`channel ${c.id === activeChannelId ? "active" : ""} ${voice.channel?.id === c.id ? "connected" : ""}`}
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

      {voice.channel && <VoicePanel voice={voice} />}
      {!voice.channel && voice.error && (
        <div className="voice-error standalone" onClick={voice.clearError} title="Dismiss">
          {voice.error}
        </div>
      )}

      <div className="user-panel">
        <Avatar user={user} size={32} status={connected ? "online" : "offline"} />
        <div className="truncate user-panel-name">
          <div className="truncate">{user.username}</div>
          <div className="muted small">{connected ? "Online" : "Reconnecting…"}</div>
        </div>
        <button
          className={`icon-btn ${voice.muted ? "danger-text" : ""}`}
          title={voice.muted ? "Unmute" : "Mute"}
          onClick={voice.toggleMute}
        >
          {voice.muted ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button className="icon-btn" title="Log out" onClick={onLogout}>
          <LogoutIcon />
        </button>
      </div>
    </aside>
  );
}
