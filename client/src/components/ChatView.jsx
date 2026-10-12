import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import { HashIcon, PlusIcon, XIcon, FileIcon } from "./icons.jsx";
import { uploadFile } from "../api.js";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;

// http(s) links and bare "www." links; trailing punctuation like "." or ")" stays outside the link.
const LINK_RE = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,:;"'!?)\]}])/gi;

/** Message text with links turned into blue, clickable links that open in the browser. */
function Linkified({ text }) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const url = match[0];
    if (match.index > last) parts.push(text.slice(last, match.index));
    const href = url.toLowerCase().startsWith("www.") ? `https://${url}` : url;
    parts.push(
      <a key={match.index} className="link" href={href} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    );
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const formatSize = (bytes) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Pictures and GIFs show in the chat, videos get a player, everything else is a download card. */
function Attachment({ file, onMediaLoad }) {
  if (file.mime.startsWith("image/") && file.mime !== "image/svg+xml") {
    return (
      <a href={file.url} target="_blank" rel="noopener noreferrer" className="attachment-media">
        <img src={file.url} alt={file.filename} loading="lazy" onLoad={onMediaLoad} />
      </a>
    );
  }
  if (["video/mp4", "video/webm"].includes(file.mime)) {
    return <video className="attachment-media" src={file.url} controls preload="metadata" onLoadedMetadata={onMediaLoad} />;
  }
  return (
    <a className="attachment-file" href={file.url} download={file.filename} target="_blank" rel="noopener noreferrer">
      <FileIcon size={32} />
      <span className="attachment-file-text">
        <span className="attachment-file-name">{file.filename}</span>
        <span className="muted small">{formatSize(file.size)}</span>
      </span>
    </a>
  );
}

function MessageContent({ message, onMediaLoad }) {
  return (
    <>
      {message.content && (
        <div className="msg-content">
          <Linkified text={message.content} />
        </div>
      )}
      {message.attachments?.length > 0 && (
        <div className="attachments">
          {message.attachments.map((f) => (
            <Attachment key={f.id} file={f} onMediaLoad={onMediaLoad} />
          ))}
        </div>
      )}
    </>
  );
}

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
  // Files picked for the next message: { key, name, preview, status: "uploading" | "done", attachment }
  const [pending, setPending] = useState([]);
  const fileInputRef = useRef(null);
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
    setPending([]);
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

  // Pictures change the list's height once they load; stay at the bottom if we were there.
  const onMediaLoad = () => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  };

  function addFiles(fileList) {
    const files = [...fileList];
    if (files.length === 0) return;
    const room = MAX_FILES - pending.length;
    if (files.length > room) setError(`You can send up to ${MAX_FILES} files at once`);
    else setError(null);

    for (const file of files.slice(0, Math.max(room, 0))) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`"${file.name}" is too big (10 MB max)`);
        continue;
      }
      const key = `${Date.now()}-${Math.random()}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setPending((p) => [...p, { key, name: file.name || "file", preview, status: "uploading" }]);
      uploadFile(channel.id, file)
        .then((attachment) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "done", attachment } : x))))
        .catch((err) => {
          setPending((p) => p.filter((x) => x.key !== key));
          setError(`Couldn't upload "${file.name}": ${err.message}`);
        });
    }
    inputRef.current?.focus();
  }

  function removePending(key) {
    setPending((p) => {
      const item = p.find((x) => x.key === key);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return p.filter((x) => x.key !== key);
    });
  }

  function send() {
    const content = text.trim();
    if (pending.some((p) => p.status === "uploading")) return setError("Wait for your files to finish uploading");
    const attachmentIds = pending.map((p) => p.attachment.id);
    if (!content && attachmentIds.length === 0) return;
    socket.emit("message:send", { channelId: channel.id, content, attachmentIds }, (res) => {
      if (res?.error) setError(res.error);
    });
    pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview));
    setPending([]);
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
    <div
      className="chat"
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
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
              <div className="msg-body">
                <MessageContent message={m} onMediaLoad={onMediaLoad} />
              </div>
            </div>
          ) : (
            <div key={m.id} className="msg">
              <Avatar user={m.author} size={40} />
              <div className="msg-body">
                <div className="msg-head">
                  <span className="msg-author">{m.author.username}</span>
                  <span className="msg-time">{formatStamp(m.createdAt)}</span>
                </div>
                <MessageContent message={m} onMediaLoad={onMediaLoad} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="composer">
        {error && <div className="error small">{error}</div>}
        {pending.length > 0 && (
          <div className="pending-files">
            {pending.map((p) => (
              <div key={p.key} className={`pending-file ${p.status}`}>
                {p.preview ? <img src={p.preview} alt="" /> : <FileIcon size={36} />}
                <span className="pending-file-name">{p.status === "uploading" ? "Uploading…" : p.name}</span>
                <button className="pending-file-remove" title="Remove" aria-label={`Remove ${p.name}`} onClick={() => removePending(p.key)}>
                  <XIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button
            className="composer-attach"
            title="Upload a file"
            aria-label="Upload a file"
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusIcon size={20} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = ""; // so picking the same file again still works
            }}
          />
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={onChange}
            maxLength={2000}
            placeholder={placeholder ?? `Message #${channel.name}`}
            onPaste={(e) => {
              if (e.clipboardData.files.length > 0) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
        </div>
        <div className="typing">{typingText}</div>
      </div>
    </div>
  );
}
