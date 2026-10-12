import { useState } from "react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import { UsersIcon, MessageIcon, PhoneIcon, CheckIcon, XIcon } from "./icons.jsx";

function FriendRow({ person, status, children, onClick }) {
  return (
    <div className="friend-row" onClick={onClick} role={onClick ? "button" : undefined}>
      <Avatar user={person} size={36} status={status === "online" || status === "offline" ? status : undefined} />
      <div className="friend-row-info truncate">
        <div className="friend-row-name truncate" title={`${person.username} (@${person.handle})`}>
          {person.username} <span className="muted handle">@{person.handle}</span>
        </div>
        <div className="muted small">{statusText(person, status)}</div>
      </div>
      <div className="friend-row-actions" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const statusText = (person, status) =>
  status === "incoming" ? "Incoming friend request" : status === "outgoing" ? "Outgoing friend request" : person.online ? "Online" : "Offline";

function RoundAction({ title, onClick, danger, success, children }) {
  return (
    <button
      className={`round-action ${danger ? "danger" : ""} ${success ? "success" : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AddFriend({ myHandle }) {
  const [handle, setHandle] = useState("");
  const [result, setResult] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await api("/friends/requests", { method: "POST", body: { handle } });
      setResult({
        ok: true,
        text:
          res.status === "accepted"
            ? `You and @${res.user.handle} are now friends!`
            : `Friend request sent to @${res.user.handle}.`,
      });
      setHandle("");
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-friend">
      <h2>Add Friend</h2>
      <p className="muted">You can add friends with their username.</p>
      <form className={`add-friend-box ${result ? (result.ok ? "ok" : "bad") : ""}`} onSubmit={submit}>
        <input
          autoFocus
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            setResult(null);
          }}
          placeholder="Enter a username, like jjmoran"
          maxLength={26}
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn primary" disabled={busy || !handle.trim()}>
          Send Friend Request
        </button>
      </form>
      {result && <p className={result.ok ? "success-text" : "error"}>{result.text}</p>}
      <p className="muted small my-handle">
        Your username is <strong>@{myHandle}</strong>. Share it so friends can add you.
      </p>
    </div>
  );
}

export default function FriendsView({ friends, user, onMessage, onCall }) {
  const [tab, setTab] = useState("online");
  const [error, setError] = useState(null);

  const run = async (request) => {
    setError(null);
    try {
      await request();
    } catch (err) {
      setError(err.message);
    }
  };
  const accept = (u) => run(() => api(`/friends/requests/${u.id}/accept`, { method: "POST", body: {} }));
  const decline = (u) => run(() => api(`/friends/requests/${u.id}`, { method: "DELETE" }));
  const remove = (u) => {
    if (window.confirm(`Remove ${u.username} (@${u.handle}) from your friends?`)) {
      run(() => api(`/friends/${u.id}`, { method: "DELETE" }));
    }
  };

  const online = friends.friends.filter((f) => f.online);
  const pendingCount = friends.incoming.length;
  const list = tab === "online" ? online : friends.friends;

  const tabs = [
    ["online", "Online"],
    ["all", "All"],
    ["pending", "Pending"],
  ];

  return (
    <div className="friends-view">
      <header className="content-header friends-header">
        <UsersIcon size={22} />
        <span>Friends</span>
        <div className="friends-tabs">
          {tabs.map(([id, label]) => (
            <button key={id} className={`friends-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              {label}
              {id === "pending" && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </button>
          ))}
          <button className={`friends-tab add ${tab === "add" ? "active" : ""}`} onClick={() => setTab("add")}>
            Add Friend
          </button>
        </div>
      </header>

      <div className="friends-body">
        {error && <p className="error">{error}</p>}

        {tab === "add" && <AddFriend myHandle={user.handle} />}

        {(tab === "online" || tab === "all") && (
          <>
            <h3 className="section-title list-title">
              {tab === "online" ? "Online" : "All friends"} — {list.length}
            </h3>
            {list.length === 0 && (
              <div className="friends-empty muted">
                {friends.friends.length === 0 ? (
                  <>
                    No friends yet.{" "}
                    <button className="link" onClick={() => setTab("add")}>
                      Add a friend by username
                    </button>
                  </>
                ) : (
                  "Nobody is online right now."
                )}
              </div>
            )}
            {list.map((f) => (
              <FriendRow key={f.id} person={f} status={f.online ? "online" : "offline"} onClick={() => onMessage(f)}>
                <RoundAction title="Message" onClick={() => onMessage(f)}>
                  <MessageIcon size={18} />
                </RoundAction>
                <RoundAction title="Start voice call" onClick={() => onCall(f, false)}>
                  <PhoneIcon size={18} />
                </RoundAction>
                <RoundAction title="Remove friend" danger onClick={() => remove(f)}>
                  <XIcon size={18} />
                </RoundAction>
              </FriendRow>
            ))}
          </>
        )}

        {tab === "pending" && (
          <>
            <h3 className="section-title list-title">
              Pending — {friends.incoming.length + friends.outgoing.length}
            </h3>
            {friends.incoming.length + friends.outgoing.length === 0 && (
              <div className="friends-empty muted">No pending friend requests.</div>
            )}
            {friends.incoming.map((u) => (
              <FriendRow key={u.id} person={u} status="incoming">
                <RoundAction title="Accept" success onClick={() => accept(u)}>
                  <CheckIcon size={18} />
                </RoundAction>
                <RoundAction title="Ignore" danger onClick={() => decline(u)}>
                  <XIcon size={18} />
                </RoundAction>
              </FriendRow>
            ))}
            {friends.outgoing.map((u) => (
              <FriendRow key={u.id} person={u} status="outgoing">
                <RoundAction title="Cancel request" danger onClick={() => decline(u)}>
                  <XIcon size={18} />
                </RoundAction>
              </FriendRow>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
