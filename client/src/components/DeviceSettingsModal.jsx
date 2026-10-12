import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { cameraConstraints, micConstraints } from "../voice/useVoice.js";

/** Pick which camera and microphone to use, with a live preview and mic level meter. */
export default function DeviceSettingsModal({ voice, onClose }) {
  const videoRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [micError, setMicError] = useState(null);
  const [level, setLevel] = useState(0);
  const { cameras, mics } = voice.devices;

  // Live camera preview of the selected camera.
  useEffect(() => {
    let stream;
    let cancelled = false;
    setCameraError(null);
    navigator.mediaDevices
      .getUserMedia({ video: cameraConstraints(voice.cameraId) })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        voice.refreshDevices(); // names only show up after permission is granted
      })
      .catch(() => setCameraError("Can't open this camera. If it's DroidCam, make sure the DroidCam app is connected."));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [voice.cameraId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mic level meter for the selected microphone.
  useEffect(() => {
    let stream;
    let ctx;
    let frame;
    let cancelled = false;
    setMicError(null);
    navigator.mediaDevices
      .getUserMedia({ audio: micConstraints(voice.micId) })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        voice.refreshDevices();
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 64));
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => setMicError("Can't open this microphone."));
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      ctx?.close().catch(() => {});
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [voice.micId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title="Voice & Video" onClose={onClose}>
      <label htmlFor="camera-select">Camera</label>
      <select id="camera-select" value={voice.cameraId} onChange={(e) => voice.setCamera(e.target.value)}>
        <option value="">Default camera</option>
        {cameras.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Camera ${i + 1}`}
          </option>
        ))}
      </select>
      <div className="camera-preview">
        <video ref={videoRef} autoPlay playsInline muted />
        {cameraError && <p className="camera-preview-error">{cameraError}</p>}
      </div>

      <label htmlFor="mic-select">Microphone</label>
      <select id="mic-select" value={voice.micId} onChange={(e) => voice.setMic(e.target.value)}>
        <option value="">Default microphone</option>
        {mics.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </select>
      <div className="mic-meter" aria-label="Microphone level">
        <div style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      {micError ? <p className="error">{micError}</p> : <p className="muted small">Talk and the bar should move.</p>}

      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
