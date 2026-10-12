import { useState } from "react";
import { api } from "../api.js";
import Modal from "./Modal.jsx";
import Avatar from "./Avatar.jsx";
import { NAME_MAX } from "../dm.js";

/** Edit your display name and @username. */
export default function ProfileModal({ user, onClose, onSaved }) {
  const [username, setUsername] = useState(user.username);
  const [handle, setHandle] = useState(user.handle ?? "");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {};
      if (username.trim() !== user.username) body.username = username;
      if (handle.trim().toLowerCase() !== user.handle) body.handle = handle;
      if (Object.keys(body).length) onSaved(await api("/me", { method: "PATCH", body }));
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="My Profile" onClose={onClose}>
      <div className="profile-preview">
        <Avatar user={{ ...user, username }} size={72} />
      </div>
      <form onSubmit={submit}>
        <label htmlFor="display-name">Display name</label>
        <input id="display-name" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={NAME_MAX} />

        <label htmlFor="handle">Username</label>
        <div className="handle-input">
          <span>@</span>
          <input
            id="handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ""))}
            maxLength={NAME_MAX}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <p className="muted small">Friends add you with this. Up to {NAME_MAX} characters: lowercase letters, numbers, _ and . only.</p>

        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !username.trim() || handle.length < 2}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
