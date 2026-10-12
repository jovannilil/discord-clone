import Avatar from "./Avatar.jsx";
import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, ScreenIcon, PhoneOffIcon, LogoutIcon, SettingsIcon } from "./icons.jsx";

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

/** Bottom of the left sidebar: voice connection controls + your profile. */
export default function UserArea({ user, voice, connected, onLogout, onEditProfile }) {
  return (
    <>
      {voice.channel && <VoicePanel voice={voice} />}
      {!voice.channel && voice.error && (
        <div className="voice-error standalone" onClick={voice.clearError} title="Dismiss">
          {voice.error}
        </div>
      )}
      <div className="user-panel">
        <button className="user-panel-me" onClick={onEditProfile} title="Edit profile">
          <Avatar user={user} size={32} status={connected ? "online" : "offline"} />
          <div className="truncate user-panel-name">
            <div className="truncate">{user.username}</div>
            <div className="muted small truncate">{connected ? `@${user.handle}` : "Reconnecting…"}</div>
          </div>
        </button>
        <button
          className={`icon-btn ${voice.muted ? "danger-text" : ""}`}
          title={voice.muted ? "Unmute" : "Mute"}
          onClick={voice.toggleMute}
        >
          {voice.muted ? <MicOffIcon /> : <MicIcon />}
        </button>
        <button className="icon-btn" title="Voice & Video settings" aria-label="Voice & Video settings" onClick={voice.openSettings}>
          <SettingsIcon />
        </button>
        <button className="icon-btn" title="Log out" onClick={onLogout}>
          <LogoutIcon />
        </button>
      </div>
    </>
  );
}
