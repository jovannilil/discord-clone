import { useEffect, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { micConstraints, fixVirtualCamera } from "../voice/useVoice.js";
import { checkPicture } from "../voice/pictureCheck.js";

const MODE_NAMES = { compat: "640×480", native: "the camera's own size", low: "320×240", hd: "HD 1280×720" };

function FixResult({ result }) {
  if (result.ok) {
    return (
      <p className="success-text">
        Fixed! Using {result.name} at {MODE_NAMES[result.mode]}.
      </p>
    );
  }
  const names = [...new Set(result.tried.map((t) => t.name))];
  return (
    <div className="fix-failed">
      <p>
        <strong>None of your cameras sent a real picture</strong>{" "}
        {names.length ? `(tried ${names.join(", ")} in every size).` : "(no cameras found)."} The app is receiving
        a blank picture from the camera itself, so this needs fixing on the DroidCam side:
      </p>
      <ol>
        <li>
          On the PC, open the <strong>DroidCam</strong> program. You must see your phone's live video <em>in that
          window</em>. If it's black or green there too, DroidCam isn't streaming yet.
        </li>
        <li>
          In the DroidCam PC program press <strong>Stop</strong>, then <strong>Start</strong> again (phone app open and
          on the same Wi-Fi). On iPhone keep the DroidCam app open and the screen on.
        </li>
        <li>Close other apps that might be using the camera (Zoom, OBS, Discord, Teams, browser tabs).</li>
        <li>Then come back here and press "Fix camera automatically" again.</li>
      </ol>
      <p className="muted small">
        Still green? Reinstall the DroidCam PC client from dev47apps.com and restart the computer, since its camera
        driver sometimes doesn't install properly.
      </p>
    </div>
  );
}

/** Pick which camera and microphone to use, with a live preview and mic level meter. */
export default function DeviceSettingsModal({ voice, onClose }) {
  const videoRef = useRef(null);
  const [cameraError, setCameraError] = useState(null);
  const [micError, setMicError] = useState(null);
  const [level, setLevel] = useState(0);
  const [previewInfo, setPreviewInfo] = useState("");
  const [pictureStatus, setPictureStatus] = useState(null); // null | "ok" | "green" | "black"
  const [fixing, setFixing] = useState(null); // progress text while the auto-fix runs
  const [fixResult, setFixResult] = useState(null);
  const { cameras, mics } = voice.devices;
  const cameraLabel = cameras.find((d) => d.deviceId === voice.cameraId)?.label ?? "";

  // Live camera preview, opened exactly the way a call would open it.
  useEffect(() => {
    if (fixing) return; // the auto-fix needs the camera to itself
    let stream;
    let cancelled = false;
    setCameraError(null);
    setPreviewInfo("");
    setPictureStatus(null);
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
        checkPicture(new MediaStream([track])).then((status) => !cancelled && setPictureStatus(status));
      })
      .catch(() => setCameraError("Can't open this camera. If it's DroidCam, make sure the DroidCam app is connected."));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [voice.cameraId, voice.cameraMode, cameraLabel, fixing]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fixCamera() {
    setFixResult(null);
    setFixing("Starting…");
    const result = await voice.findWorkingCamera(setFixing);
    setFixing(null);
    setFixResult(result);
  }

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
        <video ref={videoRef} autoPlay playsInline muted className={fixing ? "hidden" : ""} />
        {fixing && <p className="camera-preview-error">{fixing}</p>}
        {!fixing && cameraError && <p className="camera-preview-error">{cameraError}</p>}
      </div>
      {previewInfo && !fixing && <p className="muted small preview-info">{previewInfo}</p>}

      {!fixing && (pictureStatus === "green" || pictureStatus === "black") && !fixResult && (
        <p className="error">
          This camera is sending a blank {pictureStatus} picture. Press "Fix camera automatically" below.
        </p>
      )}
      <button className="btn success full" onClick={fixCamera} disabled={!!fixing}>
        {fixing ? "Finding a working camera…" : "Fix camera automatically"}
      </button>
      {fixResult && <FixResult result={fixResult} />}

      <label htmlFor="camera-mode">Camera mode</label>
      <select id="camera-mode" value={voice.cameraMode} onChange={(e) => voice.setCameraMode(e.target.value)}>
        <option value="auto">Auto (recommended)</option>
        <option value="compat">Compatibility, 640×480</option>
        <option value="native">Camera's own size</option>
        <option value="low">Low, 320×240</option>
        <option value="hd">HD, 1280×720</option>
      </select>

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
