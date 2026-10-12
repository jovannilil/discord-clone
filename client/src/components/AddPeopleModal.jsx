import { useState } from "react";
import Modal from "./Modal.jsx";
import Avatar from "./Avatar.jsx";
import { CheckIcon } from "./icons.jsx";
import { GROUP_MAX } from "../dm.js";

/**
 * Pick friends to start a group or add to a call.
 * `existingIds` are people already in the conversation (shown as "Already here").
 */
export default function AddPeopleModal({ title, friends, existingIds = [], confirmLabel, onConfirm, onClose }) {
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const slotsLeft = GROUP_MAX - existingIds.length - selected.size;
  const query = search.trim().toLowerCase();
  const list = friends.filter(
    (f) => !query || f.username.toLowerCase().includes(query) || f.handle?.includes(query)
  );

  const toggle = (id) =>
    setSelected((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else if (slotsLeft > 0) next.add(id);
      return next;
    });

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm([...selected]);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted small picker-hint">
        {slotsLeft > 0
          ? `You can add ${slotsLeft} more ${slotsLeft === 1 ? "friend" : "friends"} (up to ${GROUP_MAX} people).`
          : `That's the maximum of ${GROUP_MAX} people.`}
      </p>
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Type the name of a friend"
        autoComplete="off"
      />
      <div className="picker-list">
        {friends.length === 0 && <p className="muted center">Add some friends first.</p>}
        {list.map((f) => {
          const already = existingIds.includes(f.id);
          const checked = selected.has(f.id);
          return (
            <button
              key={f.id}
              type="button"
              className={`picker-row ${checked ? "checked" : ""}`}
              disabled={already || (!checked && slotsLeft <= 0)}
              onClick={() => toggle(f.id)}
            >
              <Avatar user={f} size={32} status={f.online ? "online" : "offline"} />
              <span className="picker-name truncate" title={`${f.username} (@${f.handle})`}>
                {f.username} <span className="muted handle">@{f.handle}</span>
              </span>
              {already ? (
                <span className="muted small">Already here</span>
              ) : (
                <span className="picker-check">{checked && <CheckIcon size={14} />}</span>
              )}
            </button>
          );
        })}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || selected.size === 0} onClick={confirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
