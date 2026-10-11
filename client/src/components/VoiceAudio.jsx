import { useEffect, useRef } from "react";

// Plays everyone's voice. Lives outside the voice page so audio keeps going
// while you browse text channels or other servers.
function PeerAudio({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream ?? null;
    if (stream) el.play().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

export default function VoiceAudio({ peers }) {
  return (
    <div hidden>
      {Object.entries(peers).map(([socketId, peer]) => (
        <PeerAudio key={socketId} stream={peer.stream} />
      ))}
    </div>
  );
}
