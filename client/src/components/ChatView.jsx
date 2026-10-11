import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import { HashIcon } from "./icons.jsx";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function formatStamp(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Today at ${formatTime(ts)}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday at ${formatTime(ts)}`;
  return `${d.toLocaleDateString()} ${formatTime(ts)}`;
}

// For DMs, `showHeader` is false (DMView draws its own header) and `intro` / `placeholder` are customized.
export default function ChatView({ channel, state, socket, typing, onLoadOlder, showHeader = true, intro, placeholder }) {
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [, setTick] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const restoreScrollRef = useRef(null);
  const lastChannelRef = useRef(null);
  const lastTypingSentRef = useRef(0);

  const items = state?.items ?? [];

  // Re-render every second so typing indicators expire.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setText("");
    setError(null);
    inputRef.current?.focus();
  }, [channel.id]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (lastChannelRef.current !== channel.id) {
      lastChannelRef.current = channel.id;
      stickToBottomRef.current = true;
    }
    if (restoreScrollRef.current) {
      // Older messages were added at the top: keep the view where it was.
      const { height, top } = restoreScrollRef.current;
      el.scrollTop = el.scrollHeight - height + top;
      restoreScrollRef.current = null;
    } else if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items, channel.id]);

  const onScroll = () => {
    const el = listRef.current;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = () => {
    const el = listRef.current;
    restoreScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
    onLoadOlder();
  };

  function send() {
    const content = text.trim();
    if (!content) return;
    socket.emit("message:send", { channelId: channel.id, content }, (res) => {
      if (res?.error) setError(res.error);
    });
    setText("");
    setError(null);
    stickToBottomRef.current = true;
  }

  function onChange(e) {
    setText(e.target.value);
    const now = Date.now();
    if (e.target.value && now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now;
      socket.emit("typing", { channelId: channel.id });
    }
  }

  const now = Date.now();
  const typers = Object.values(typing ?? {})
    .filter((t) => t.until > now)
    .map((t) => t.username);
  const typingText =
    typers.length === 0
      ? ""
      : typers.length === 1
        ? `${typers[0]} is typing…`
        : typers.length <= 3
          ? `${typers.join(", ")} are typing…`
          : "Several people are typing…";

  return (
    <div className="chat">
      {showHeader && (
        <header className="content-header">
          <HashIcon size={22} />
          <span>{channel.name}</span>
        </header>
      )}

      <div className="messages" ref={listRef} onScroll={onScroll}>
        {state?.hasMore ? (
          <button className="load-older" onClick={loadOlder}>
            Load older messages
          </button>
        ) : (
          state?.loaded &&
          (intro ?? (
            <div className="channel-intro">
              <div className="channel-intro-icon">
                <HashIcon size={36} />
              </div>
              <h2>Welcome to #{channel.name}!</h2>
              <p className="muted">This is the start of the #{channel.name} channel.</p>
            </div>
          ))
        )}
        {!state?.loaded && <div className="muted center">Loading messages…</div>}

        {items.map((m, i) => {
          const prev = items[i - 1];
          const grouped = prev && prev.author.id === m.author.id && m.createdAt - prev.createdAt < GROUP_WINDOW_MS;
          return grouped ? (
            <div key={m.id} className="msg grouped">
              <span className="msg-hover-time">{formatTime(m.createdAt)}</span>
              <div className="msg-content">{m.content}</div>
            </div>
          ) : (
            <div key={m.id} className="msg">
              <Avatar user={m.author} size={40} />
              <div className="msg-body">
                <div className="msg-head">
                  <span className="msg-author">{m.author.username}</span>
                  <span className="msg-time">{formatStamp(m.createdAt)}</span>
                </div>
                <div className="msg-content">{m.content}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="composer">
        {error && <div className="error small">{error}</div>}
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={onChange}
          maxLength={2000}
          placeholder={placeholder ?? `Message #${channel.name}`}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="typing">{typingText}</div>
      </div>
    </div>
  );
}
