import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import { SpeakerIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, ScreenIcon, PhoneOffIcon, SettingsIcon, UserPlusIcon, XIcon } from "./icons.jsx";

function Tile({ participant, stream, mirror, connecting, onOpen }) {
  const videoRef = useRef(null);
  const showVideo = participant.video && stream;

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);

  return (
    <div
      className={`tile ${showVideo ? "clickable" : ""}`}
      title={showVideo ? "Click to view full screen" : undefined}
      onClick={showVideo ? onOpen : undefined}
    >
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

/** One person's video filling the whole screen, with an X (or Esc) to get back out. */
function FullscreenVideo({ participant, stream, mirror, onClose }) {
  const boxRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream ?? null;
  }, [stream]);

  useEffect(() => {
    // Fill the whole monitor when allowed; otherwise the overlay still covers the app window.
    boxRef.current?.requestFullscreen?.().catch(() => {});
    const onKey = (e) => e.key === "Escape" && onClose();
    // Esc in real full screen exits it without a keydown reaching us, so close the overlay too.
    const onFsChange = () => !document.fullscreenElement && onClose();
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFsChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);

  return (
    <div className="video-fullscreen" ref={boxRef}>
      <video ref={videoRef} autoPlay playsInline muted className={mirror ? "mirror" : ""} />
      <button className="video-fullscreen-close" title="Exit full screen" aria-label="Exit full screen" onClick={onClose}>
        <XIcon size={28} />
      </button>
      <div className="tile-name">
        <span>
          {participant.user.username}
          {participant.isSelf && " (you)"}
        </span>
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
export function CallPanel({ voice, onAddPeople }) {
  const [fullscreenId, setFullscreenId] = useState(null);
  const closeFullscreen = useCallback(() => setFullscreenId(null), []);
  const streamOf = (p) => (p.isSelf ? voice.localVideoStream : voice.peers[p.socketId]?.stream);
  const mirrorOf = (p) => p.isSelf && voice.videoMode === "camera";

  // Full screen closes on its own if that person leaves or turns their video off.
  const focused = voice.participants.find((p) => p.socketId === fullscreenId);
  const focusedStream = focused?.video ? streamOf(focused) : null;

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
              stream={streamOf(p)}
              mirror={mirrorOf(p)}
              connecting={connecting}
              onOpen={() => setFullscreenId(p.socketId)}
            />
          );
        })}
      </div>

      {focusedStream && (
        <FullscreenVideo participant={focused} stream={focusedStream} mirror={mirrorOf(focused)} onClose={closeFullscreen} />
      )}

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
        {onAddPeople && (
          <button className="round-btn" title="Add people to the call" aria-label="Add people to the call" onClick={onAddPeople}>
            <UserPlusIcon size={22} />
          </button>
        )}
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
