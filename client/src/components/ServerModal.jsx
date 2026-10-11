import { useState } from "react";
import { api } from "../api.js";
import Modal from "./Modal.jsx";

export default function ServerModal({ onClose, onDone }) {
  const [mode, setMode] = useState("create");
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (next) => {
    setMode(next);
    setValue("");
    setError(null);
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const server =
        mode === "create"
          ? await api("/servers", { method: "POST", body: { name: value } })
          : await api("/servers/join", { method: "POST", body: { inviteCode: value } });
      onDone(server);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === "create" ? "Create a server" : "Join a server"} onClose={onClose}>
      <div className="tabs">
        <button type="button" className={mode === "create" ? "active" : ""} onClick={() => switchMode("create")}>
          Create
        </button>
        <button type="button" className={mode === "join" ? "active" : ""} onClick={() => switchMode("join")}>
          Join with invite
        </button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="server-value">{mode === "create" ? "Server name" : "Invite code"}</label>
        <input
          id="server-value"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={mode === "create" ? "My awesome server" : "e.g. 3f9a1c2b"}
          maxLength={50}
          autoComplete="off"
        />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || !value.trim()}>
            {mode === "create" ? "Create" : "Join"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
