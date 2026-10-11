import { useState } from "react";
import { api } from "../api.js";
import Modal from "./Modal.jsx";
import { HashIcon, SpeakerIcon } from "./icons.jsx";

export default function ChannelModal({ serverId, initialType = "text", onClose }) {
  const [type, setType] = useState(initialType);
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The new channel shows up for everyone through the "channel:created" socket event.
      await api(`/servers/${serverId}/channels`, { method: "POST", body: { name, type } });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Create channel" onClose={onClose}>
      <form onSubmit={submit}>
        <label>Channel type</label>
        <div className="type-picker">
          <button type="button" className={type === "text" ? "active" : ""} onClick={() => setType("text")}>
            <HashIcon size={20} /> Text
          </button>
          <button type="button" className={type === "voice" ? "active" : ""} onClick={() => setType("voice")}>
            <SpeakerIcon size={20} /> Voice
          </button>
        </div>
        <label htmlFor="channel-name">Channel name</label>
        <input
          id="channel-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === "text" ? "new-channel" : "Lounge"}
          maxLength={32}
          autoComplete="off"
        />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !name.trim()}>
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
