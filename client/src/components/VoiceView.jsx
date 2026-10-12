import { useEffect, useRef } from "react";
import Avatar from "./Avatar.jsx";
import { SpeakerIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, ScreenIcon, PhoneOffIcon, SettingsIcon } from "./icons.jsx";

function Tile({ participant, stream, mirror, connecting }) {
  const videoRef = useRef(null);
  const showVideo = participant.video && stream;

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);

  return (
    <div className="tile">
      {/* Always muted: audio plays through <VoiceAudio> so you still hear people on other pages. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`${showVideo ? "" : "hidden"} ${mirror ? "mirror" : ""}`}
      />
      {!showVideo && <Avatar user={participant.user} size={88} />}
      <div className="tile-name">
        {participant.muted && <MicOffIcon size={14} />}
        <span>
          {participant.user.username}
          {participant.isSelf && " (you)"}
        </span>
        {connecting && <span className="muted small"> · connecting…</span>}
      </div>
    </div>
  );
}

export default function VoiceView({ channel, voice, participantsHere, onJoin }) {
  const inThisChannel = voice.channel?.id === channel.id;

  if (!inThisChannel) {
    return (
      <div className="voice-lobby">
        <div className="voice-lobby-icon">
          <SpeakerIcon size={40} />
        </div>
        <h2>{channel.name}</h2>
        <p className="muted">
          {participantsHere.length === 0
            ? "No one is here yet."
            : `${participantsHere.map((p) => p.user.username).join(", ")} ${participantsHere.length === 1 ? "is" : "are"} in voice.`}
        </p>
        <button className="btn success" onClick={onJoin}>
          Join Voice
        </button>
      </div>
    );
  }

  return (
    <div className="voice-view">
      <header className="content-header">
        <SpeakerIcon size={22} />
        <span>{channel.name}</span>
      </header>

      <CallPanel voice={voice} />
    </div>
  );
}

/** The call itself: everyone's video/avatar tiles plus mute / camera / screen / hang up. */
export function CallPanel({ voice }) {
  return (
    <>
      <div className="tiles">
        {voice.participants.map((p) => {
          const peer = voice.peers[p.socketId];
          const connecting = !p.isSelf && (!peer || !["connected", "completed"].includes(peer.state));
          return (
            <Tile
              key={p.socketId}
              participant={p}
              stream={p.isSelf ? voice.localVideoStream : peer?.stream}
              mirror={p.isSelf && voice.videoMode === "camera"}
              connecting={connecting}
            />
          );
        })}
      </div>

      <div className="voice-controls">
        <button
          className={`round-btn ${voice.muted ? "off" : ""}`}
          title={voice.muted ? "Unmute" : "Mute"}
          onClick={voice.toggleMute}
        >
          {voice.muted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
        </button>
        <button
          className={`round-btn ${voice.videoMode === "camera" ? "active" : ""}`}
          title={voice.videoMode === "camera" ? "Turn off camera" : "Turn on camera"}
          onClick={voice.toggleCamera}
        >
          {voice.videoMode === "camera" ? <VideoIcon size={22} /> : <VideoOffIcon size={22} />}
        </button>
        <button
          className={`round-btn ${voice.videoMode === "screen" ? "active" : ""}`}
          title={voice.videoMode === "screen" ? "Stop sharing" : "Share your screen"}
          onClick={voice.toggleScreen}
        >
          <ScreenIcon size={22} />
        </button>
        <button className="round-btn" title="Voice & Video settings" aria-label="Voice & Video settings" onClick={voice.openSettings}>
          <SettingsIcon size={22} />
        </button>
        <button className="round-btn hangup" title="Disconnect" onClick={voice.leave}>
          <PhoneOffIcon size={22} />
        </button>
      </div>
    </>
  );
}
