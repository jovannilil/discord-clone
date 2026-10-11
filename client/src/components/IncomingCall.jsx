import { useEffect } from "react";
import Avatar from "./Avatar.jsx";
import { PhoneIcon, PhoneOffIcon } from "./icons.jsx";

// A simple phone-style ring made with the Web Audio API (no sound files needed).
function startRinging() {
  let ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return () => {};
  }
  const ringOnce = () => {
    const now = ctx.currentTime;
    for (const [start, freq] of [[0, 440], [0, 480], [0.5, 440], [0.5, 480]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.08, now + start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + 0.45);
    }
  };
  ringOnce();
  const timer = setInterval(ringOnce, 2500);
  return () => {
    clearInterval(timer);
    ctx.close().catch(() => {});
  };
}

export default function IncomingCall({ dm, onAccept, onDecline }) {
  useEffect(() => startRinging(), [dm.id]);

  const caller = dm.voice?.find((p) => p.user.id === dm.user.id)?.user ?? dm.user;
  const withVideo = dm.voice?.some((p) => p.video);

  return (
    <div className="incoming-call" role="alertdialog" aria-label={`Incoming call from ${caller.username}`}>
      <div className="incoming-call-avatar">
        <Avatar user={caller} size={80} />
      </div>
      <h3>{caller.username}</h3>
      <p className="muted">Incoming {withVideo ? "video " : ""}call…</p>
      <div className="incoming-call-actions">
        <button className="round-btn hangup" title="Decline" aria-label="Decline" onClick={onDecline}>
          <PhoneOffIcon size={22} />
        </button>
        <button className="round-btn accept" title="Accept" aria-label="Accept" onClick={onAccept}>
          <PhoneIcon size={22} />
        </button>
      </div>
    </div>
  );
}
