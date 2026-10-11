import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, getToken } from "../api.js";
import { useVoice } from "../voice/useVoice.js";
import ServerRail from "./ServerRail.jsx";
import ChannelSidebar from "./ChannelSidebar.jsx";
import ChatView from "./ChatView.jsx";
import VoiceView from "./VoiceView.jsx";
import VoiceAudio from "./VoiceAudio.jsx";
import MemberList from "./MemberList.jsx";
import ServerModal from "./ServerModal.jsx";
import ChannelModal from "./ChannelModal.jsx";

export default function Main({ user, config, onLogout }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [servers, setServers] = useState(null);
  const [activeServerId, setActiveServerId] = useState(null);
  const [serverData, setServerData] = useState(null); // { server, channels, members, voiceStates }
  const [activeChannelIds, setActiveChannelIds] = useState({}); // serverId -> channelId
  const [messages, setMessages] = useState({}); // channelId -> { items, hasMore, loaded }
  const [typing, setTyping] = useState({}); // channelId -> { userId: { username, until } }
  const [modal, setModal] = useState(null);

  const activeServerRef = useRef(null);
  activeServerRef.current = activeServerId;
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  const voice = useVoice(socket, config.iceServers);

  const loadServer = useCallback(async (id) => {
    const data = await api(`/servers/${id}`);
    if (activeServerRef.current === id) setServerData(data);
  }, []);

  // ---------- Socket connection ----------
  useEffect(() => {
    const s = io({ auth: { token: getToken() } });
    let hasConnected = false;
    s.on("connect", () => {
      setConnected(true);
      if (hasConnected) {
        // Reconnected: refetch anything we may have missed while offline.
        setMessages({});
        if (activeServerRef.current) loadServer(activeServerRef.current).catch(() => {});
      }
      hasConnected = true;
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (err) => {
      if (err.message === "unauthorized") onLogoutRef.current();
    });
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [loadServer]);

  // ---------- Initial data ----------
  useEffect(() => {
    api("/servers")
      .then((list) => {
        setServers(list);
        if (list.length) setActiveServerId((id) => id ?? list[0].id);
      })
      .catch((err) => {
        if (err.status === 401) onLogoutRef.current();
      });
  }, []);

  useEffect(() => {
    setServerData(null);
    if (activeServerId) loadServer(activeServerId).catch(console.error);
  }, [activeServerId, loadServer]);

  // ---------- Realtime events ----------
  useEffect(() => {
    if (!socket) return;

    const onMessage = (msg) => {
      setMessages((m) => {
        const cur = m[msg.channelId] ?? { items: [], hasMore: false, loaded: false };
        if (cur.items.some((x) => x.id === msg.id)) return m;
        return { ...m, [msg.channelId]: { ...cur, items: [...cur.items, msg] } };
      });
      setTyping((t) => {
        if (!t[msg.channelId]?.[msg.author.id]) return t;
        const { [msg.author.id]: _gone, ...rest } = t[msg.channelId];
        return { ...t, [msg.channelId]: rest };
      });
    };
    const onTyping = ({ channelId, user: u }) =>
      setTyping((t) => ({
        ...t,
        [channelId]: { ...t[channelId], [u.id]: { username: u.username, until: Date.now() + 3500 } },
      }));
    const onPresence = ({ userId, online }) =>
      setServerData((d) => d && { ...d, members: d.members.map((m) => (m.id === userId ? { ...m, online } : m)) });
    const onMemberJoined = ({ serverId, member }) =>
      setServerData((d) =>
        d && d.server.id === serverId && !d.members.some((m) => m.id === member.id)
          ? {
              ...d,
              members: [...d.members, member].sort((a, b) =>
                a.username.localeCompare(b.username, undefined, { sensitivity: "base" })
              ),
            }
          : d
      );
    const onChannelCreated = (ch) =>
      setServerData((d) =>
        d && d.server.id === ch.serverId && !d.channels.some((c) => c.id === ch.id)
          ? { ...d, channels: [...d.channels, ch] }
          : d
      );
    const onVoiceState = ({ serverId, channelId, participants }) =>
      setServerData((d) =>
        d && d.server.id === serverId ? { ...d, voiceStates: { ...d.voiceStates, [channelId]: participants } } : d
      );

    socket.on("message:new", onMessage);
    socket.on("typing", onTyping);
    socket.on("presence", onPresence);
    socket.on("member:joined", onMemberJoined);
    socket.on("channel:created", onChannelCreated);
    socket.on("voice:state", onVoiceState);
    return () => {
      socket.off("message:new", onMessage);
      socket.off("typing", onTyping);
      socket.off("presence", onPresence);
      socket.off("member:joined", onMemberJoined);
      socket.off("channel:created", onChannelCreated);
      socket.off("voice:state", onVoiceState);
    };
  }, [socket]);

  // ---------- Active channel + message history ----------
  const channels = serverData?.channels ?? [];
  const activeChannel =
    channels.find((c) => c.id === activeChannelIds[activeServerId]) ?? channels.find((c) => c.type === "text") ?? null;

  const loadMessages = useCallback(async (channelId, before) => {
    const items = await api(`/channels/${channelId}/messages${before ? `?before=${before}` : ""}`);
    setMessages((m) => {
      const cur = m[channelId];
      const seen = new Set(items.map((x) => x.id));
      const others = (cur?.items ?? []).filter((x) => !seen.has(x.id));
      return {
        ...m,
        [channelId]: {
          items: [...items, ...others].sort((a, b) => a.id - b.id),
          hasMore: items.length === 50,
          loaded: true,
        },
      };
    });
  }, []);

  const activeTextId = activeChannel?.type === "text" ? activeChannel.id : null;
  const activeLoaded = activeTextId ? !!messages[activeTextId]?.loaded : true;
  useEffect(() => {
    if (activeTextId && !activeLoaded) loadMessages(activeTextId).catch(console.error);
  }, [activeTextId, activeLoaded, loadMessages]);

  // ---------- Actions ----------
  function selectChannel(ch) {
    setActiveChannelIds((m) => ({ ...m, [activeServerId]: ch.id }));
    if (ch.type === "voice" && voice.channel?.id !== ch.id) {
      voice.join({ id: ch.id, name: ch.name, serverId: activeServerId, serverName: serverData.server.name });
    }
  }

  function onServerAdded(server) {
    setServers((list) => (list.some((s) => s.id === server.id) ? list : [...list, server]));
    setActiveServerId(server.id);
    setModal(null);
  }

  // ---------- Render ----------
  let content = null;
  if (activeChannel?.type === "voice") {
    content = (
      <VoiceView
        channel={activeChannel}
        voice={voice}
        participantsHere={serverData.voiceStates[activeChannel.id] ?? []}
        onJoin={() => selectChannel(activeChannel)}
      />
    );
  } else if (activeChannel) {
    content = (
      <ChatView
        channel={activeChannel}
        state={messages[activeChannel.id]}
        socket={socket}
        typing={typing[activeChannel.id]}
        onLoadOlder={() => loadMessages(activeChannel.id, messages[activeChannel.id]?.items[0]?.id)}
      />
    );
  } else if (serverData) {
    content = <div className="empty-state muted">This server has no text channels yet.</div>;
  }

  return (
    <div className="app">
      <ServerRail
        servers={servers ?? []}
        activeId={activeServerId}
        onSelect={setActiveServerId}
        onAdd={() => setModal({ type: "server" })}
      />

      {serverData ? (
        <>
          <ChannelSidebar
            data={serverData}
            user={user}
            activeChannelId={activeChannel?.id}
            onSelect={selectChannel}
            onCreateChannel={(type) => setModal({ type: "channel", channelType: type })}
            voice={voice}
            onLogout={onLogout}
            connected={connected}
          />
          <main className="content">{content}</main>
          <MemberList members={serverData.members} ownerId={serverData.server.ownerId} />
        </>
      ) : (
        <div className="empty-state">
          {servers && servers.length === 0 ? (
            <div className="welcome">
              <h2>Hey {user.username}, welcome!</h2>
              <p className="muted">Create a server for your friends, or join one with an invite code.</p>
              <button className="btn primary" onClick={() => setModal({ type: "server" })}>
                Create or join a server
              </button>
              <button className="btn ghost" onClick={onLogout}>
                Log out
              </button>
            </div>
          ) : (
            <span className="muted">Loading…</span>
          )}
        </div>
      )}

      <VoiceAudio peers={voice.peers} />

      {modal?.type === "server" && <ServerModal onClose={() => setModal(null)} onDone={onServerAdded} />}
      {modal?.type === "channel" && serverData && (
        <ChannelModal
          serverId={serverData.server.id}
          initialType={modal.channelType}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
