import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { micConstraints, fixVirtualCamera } from "../voice/useVoice.js";

/** Pick which camera and microphone to use, with a live preview and mic level meter. */
export default function DeviceSettingsModal({ voice, onClose }) {
  const videoRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [micError, setMicError] = useState(null);
  const [level, setLevel] = useState(0);
  const [previewInfo, setPreviewInfo] = useState("");
  const { cameras, mics } = voice.devices;
  const cameraLabel = cameras.find((d) => d.deviceId === voice.cameraId)?.label ?? "";

  // Live camera preview, opened exactly the way a call would open it.
  useEffect(() => {
    let stream;
    let cancelled = false;
    setCameraError(null);
    setPreviewInfo("");
    navigator.mediaDevices
      .getUserMedia({ video: voice.previewConstraints() })
      .then((s) => fixVirtualCamera(s, { mode: voice.cameraMode, label: cameraLabel }))
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        const track = s.getVideoTracks()[0];
        const { width, height } = track.getSettings();
        setPreviewInfo(`${track.label || "Camera"} · ${width}×${height}`);
        voice.refreshDevices(); // names only show up after permission is granted
      })
      .catch(() => setCameraError("Can't open this camera. If it's DroidCam, make sure the DroidCam app is connected."));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [voice.cameraId, voice.cameraMode, cameraLabel]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {previewInfo && <p className="muted small preview-info">{previewInfo}</p>}

      <label htmlFor="camera-mode">Camera mode</label>
      <select id="camera-mode" value={voice.cameraMode} onChange={(e) => voice.setCameraMode(e.target.value)}>
        <option value="auto">Auto (recommended)</option>
        <option value="compat">Compatibility, 640×480 (fixes a green or black picture)</option>
        <option value="hd">HD, 1280×720</option>
      </select>
      <p className="muted small">
        Picture all green or black with DroidCam or another phone camera? Choose Compatibility.
      </p>

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
