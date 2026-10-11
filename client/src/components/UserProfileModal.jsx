import { useState } from "react";
import { api } from "../api.js";
import Modal from "./Modal.jsx";
import Avatar from "./Avatar.jsx";
import { MessageIcon, UserPlusIcon, CheckIcon } from "./icons.jsx";

/** Shown when you click someone in a member list: add them as a friend or message them. */
export default function UserProfileModal({ person, me, friends, onClose, onMessage, onEditProfile }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const isMe = person.id === me.id;
  const isFriend = friends.friends.some((f) => f.id === person.id);
  const incoming = friends.incoming.some((f) => f.id === person.id);
  const outgoing = friends.outgoing.some((f) => f.id === person.id) || status === "sent";

  const run = async (request, nextStatus) => {
    setError(null);
    try {
      await request();
      setStatus(nextStatus);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={person.username} onClose={onClose}>
      <div className="profile-preview">
        <Avatar user={person} size={80} status={person.online ? "online" : "offline"} />
        <div className="muted">@{person.handle}</div>
      </div>

      <div className="profile-actions">
        {isMe ? (
          <button className="btn primary" onClick={onEditProfile}>
            Edit Profile
          </button>
        ) : (
          <>
            <button className="btn primary" onClick={() => onMessage(person)}>
              <MessageIcon size={16} /> Message
            </button>
            {isFriend || status === "friends" ? (
              <span className="btn ghost disabled">
                <CheckIcon size={16} /> Friends
              </span>
            ) : incoming ? (
              <button
                className="btn success"
                onClick={() => run(() => api(`/friends/requests/${person.id}/accept`, { method: "POST", body: {} }), "friends")}
              >
                <CheckIcon size={16} /> Accept Friend Request
              </button>
            ) : outgoing ? (
              <span className="btn ghost disabled">Friend Request Sent</span>
            ) : (
              <button
                className="btn success"
                onClick={() => run(() => api("/friends/requests", { method: "POST", body: { handle: person.handle } }), "sent")}
              >
                <UserPlusIcon size={16} /> Add Friend
              </button>
            )}
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
