import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, getToken } from "../api.js";
import { useVoice } from "../voice/useVoice.js";
import ServerRail, { HOME } from "./ServerRail.jsx";
import ChannelSidebar from "./ChannelSidebar.jsx";
import HomeSidebar from "./HomeSidebar.jsx";
import ChatView from "./ChatView.jsx";
import VoiceView from "./VoiceView.jsx";
import VoiceAudio from "./VoiceAudio.jsx";
import MemberList from "./MemberList.jsx";
import FriendsView from "./FriendsView.jsx";
import DMView from "./DMView.jsx";
import IncomingCall from "./IncomingCall.jsx";
import ServerModal from "./ServerModal.jsx";
import ChannelModal from "./ChannelModal.jsx";
import ProfileModal from "./ProfileModal.jsx";
import UserProfileModal from "./UserProfileModal.jsx";

const EMPTY_FRIENDS = { friends: [], incoming: [], outgoing: [] };

function notify(title, body) {
  try {
    if (document.hasFocus() || !("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body, silent: false });
  } catch {
    // Notifications are optional.
  }
}

export default function Main({ user, config, onLogout, onUserChange }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [servers, setServers] = useState(null);
  const [activeServerId, setActiveServerId] = useState(HOME);
  const [serverData, setServerData] = useState(null); // { server, channels, members, voiceStates }
  const [activeChannelIds, setActiveChannelIds] = useState({}); // serverId -> channelId
  const [messages, setMessages] = useState({}); // channelId -> { items, hasMore, loaded }
  const [typing, setTyping] = useState({}); // channelId -> { userId: { username, until } }
  const [modal, setModal] = useState(null);

  // Home screen: friends and direct messages
  const [friends, setFriends] = useState(EMPTY_FRIENDS);
  const [dms, setDms] = useState([]); // [{ id, user, lastMessageAt, voice }]
  const [homeView, setHomeView] = useState("friends"); // "friends" | dm channel id
  const [unread, setUnread] = useState({}); // dm channel id -> count
  const [declinedCalls, setDeclinedCalls] = useState(() => new Set());

  const activeServerRef = useRef(activeServerId);
  activeServerRef.current = activeServerId;
  const homeViewRef = useRef(homeView);
  homeViewRef.current = homeView;
  const dmsRef = useRef(dms);
  dmsRef.current = dms;
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  const voice = useVoice(socket, config.iceServers);

  const loadServer = useCallback(async (id) => {
    const data = await api(`/servers/${id}`);
    if (activeServerRef.current === id) setServerData(data);
  }, []);
  const loadFriends = useCallback(() => api("/friends").then(setFriends).catch(console.error), []);
  const loadDms = useCallback(() => api("/dms").then(setDms).catch(console.error), []);

  // ---------- Socket connection ----------
  useEffect(() => {
    const s = io({ auth: { token: getToken() } });
    let hasConnected = false;
    s.on("connect", () => {
      setConnected(true);
      if (hasConnected) {
        // Reconnected: refetch anything we may have missed while offline.
        setMessages({});
        if (activeServerRef.current && activeServerRef.current !== HOME) {
          loadServer(activeServerRef.current).catch(() => {});
        }
        loadFriends();
        loadDms();
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
  }, [loadServer, loadFriends, loadDms]);

  // ---------- Initial data ----------
  useEffect(() => {
    api("/servers")
      .then(setServers)
      .catch((err) => {
        if (err.status === 401) onLogoutRef.current();
      });
    loadFriends();
    loadDms();
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } catch {
      // ignore
    }
  }, [loadFriends, loadDms]);

  useEffect(() => {
    setServerData(null);
    if (activeServerId && activeServerId !== HOME) loadServer(activeServerId).catch(console.error);
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

      if (msg.dm) {
        if (!dmsRef.current.some((d) => d.id === msg.channelId)) loadDms();
        setDms((list) =>
          list
            .map((d) => (d.id === msg.channelId ? { ...d, lastMessageAt: msg.createdAt } : d))
            .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        );
        const fromMe = msg.author.id === user.id;
        const viewing = activeServerRef.current === HOME && homeViewRef.current === msg.channelId && document.hasFocus();
        if (!fromMe && !viewing) {
          setUnread((u) => ({ ...u, [msg.channelId]: (u[msg.channelId] ?? 0) + 1 }));
          notify(msg.author.username, msg.content);
        }
      }
    };
    const onTyping = ({ channelId, user: u }) =>
      setTyping((t) => ({
        ...t,
        [channelId]: { ...t[channelId], [u.id]: { username: u.username, until: Date.now() + 3500 } },
      }));
    const onPresence = ({ userId, online }) => {
      setServerData((d) => d && { ...d, members: d.members.map((m) => (m.id === userId ? { ...m, online } : m)) });
      setFriends((f) => ({ ...f, friends: f.friends.map((x) => (x.id === userId ? { ...x, online } : x)) }));
      setDms((list) => list.map((d) => (d.user.id === userId ? { ...d, user: { ...d.user, online } } : d)));
    };
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
    const onVoiceState = ({ serverId, channelId, participants }) => {
      if (serverId) {
        setServerData((d) =>
          d && d.server.id === serverId ? { ...d, voiceStates: { ...d.voiceStates, [channelId]: participants } } : d
        );
        return;
      }
      // A DM call started, changed or ended.
      if (!dmsRef.current.some((d) => d.id === channelId)) loadDms();
      setDms((list) => list.map((d) => (d.id === channelId ? { ...d, voice: participants } : d)));
      if (participants.length === 0) {
        setDeclinedCalls((set) => {
          if (!set.has(channelId)) return set;
          const next = new Set(set);
          next.delete(channelId);
          return next;
        });
      }
    };

    socket.on("message:new", onMessage);
    socket.on("typing", onTyping);
    socket.on("presence", onPresence);
    socket.on("member:joined", onMemberJoined);
    socket.on("channel:created", onChannelCreated);
    socket.on("voice:state", onVoiceState);
    socket.on("friends:changed", loadFriends);
    socket.on("dm:created", loadDms);
    return () => {
      socket.off("message:new", onMessage);
      socket.off("typing", onTyping);
      socket.off("presence", onPresence);
      socket.off("member:joined", onMemberJoined);
      socket.off("channel:created", onChannelCreated);
      socket.off("voice:state", onVoiceState);
      socket.off("friends:changed", loadFriends);
      socket.off("dm:created", loadDms);
    };
  }, [socket, user.id, loadFriends, loadDms]);

  // ---------- Which chat is on screen ----------
  const isHome = activeServerId === HOME;
  const channels = serverData?.channels ?? [];
  const activeChannel = isHome
    ? null
    : channels.find((c) => c.id === activeChannelIds[activeServerId]) ?? channels.find((c) => c.type === "text") ?? null;
  const activeDm = isHome && homeView !== "friends" ? dms.find((d) => d.id === homeView) ?? null : null;

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

  const chatChannelId = activeDm?.id ?? (activeChannel?.type === "text" ? activeChannel.id : null);
  const chatLoaded = chatChannelId ? !!messages[chatChannelId]?.loaded : true;
  useEffect(() => {
    if (chatChannelId && !chatLoaded) loadMessages(chatChannelId).catch(console.error);
  }, [chatChannelId, chatLoaded, loadMessages]);

  // Opening a DM marks it read.
  useEffect(() => {
    if (activeDm && unread[activeDm.id]) setUnread(({ [activeDm.id]: _read, ...rest }) => rest);
  }, [activeDm, unread]);

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

  // Opens (creating if needed) the DM with someone and shows it.
  async function openDm(person) {
    const dm = await api("/dms", { method: "POST", body: { userId: person.id } });
    setDms((list) => (list.some((d) => d.id === dm.id) ? list : [dm, ...list]));
    setActiveServerId(HOME);
    setHomeView(dm.id);
    setModal(null);
    return dm;
  }

  async function startCall(dm, withVideo) {
    setActiveServerId(HOME);
    setHomeView(dm.id);
    await voice.join({ id: dm.id, name: dm.user.username, serverId: null, serverName: "Direct Message" });
    if (withVideo) voice.toggleCamera();
  }

  const callFriend = async (person, withVideo) => {
    try {
      startCall(await openDm(person), withVideo);
    } catch (err) {
      alert(err.message);
    }
  };
  const messageFriend = (person) => openDm(person).catch((err) => alert(err.message));

  // Hanging up on a DM call counts as declining it, so it doesn't ring again while the other person waits.
  const voiceChannelId = voice.channel?.id ?? null;
  const prevVoiceChannelRef = useRef(null);
  useEffect(() => {
    const prev = prevVoiceChannelRef.current;
    prevVoiceChannelRef.current = voiceChannelId;
    if (prev && prev !== voiceChannelId && dmsRef.current.some((d) => d.id === prev)) {
      setDeclinedCalls((set) => new Set(set).add(prev));
    }
  }, [voiceChannelId]);

  // Someone is calling you in a DM you're not in yet (and haven't declined).
  const incomingCall = dms.find(
    (d) =>
      d.voice?.length > 0 &&
      voice.channel?.id !== d.id &&
      !declinedCalls.has(d.id) &&
      !d.voice.some((p) => p.user.id === user.id)
  );
  const incomingId = incomingCall?.id;
  useEffect(() => {
    if (incomingId) {
      const dm = dmsRef.current.find((d) => d.id === incomingId);
      if (dm) notify(dm.user.username, "Incoming call…");
    }
  }, [incomingId]);

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const userArea = {
    user,
    voice,
    connected,
    onLogout,
    onEditProfile: () => setModal({ type: "profile" }),
  };
  const chatProps = (channelId) => ({
    state: messages[channelId],
    socket,
    typing: typing[channelId],
    onLoadOlder: () => loadMessages(channelId, messages[channelId]?.items[0]?.id),
  });

  // ---------- Render ----------
  let sidebar = null;
  let content = null;
  let rightPanel = null;

  if (isHome) {
    sidebar = (
      <HomeSidebar
        dms={dms}
        homeView={homeView}
        unread={unread}
        pendingCount={friends.incoming.length}
        onSelect={setHomeView}
        userArea={userArea}
      />
    );
    content = activeDm ? (
      <DMView dm={activeDm} voice={voice} chat={chatProps(activeDm.id)} onCall={startCall} />
    ) : (
      <FriendsView friends={friends} user={user} onMessage={messageFriend} onCall={callFriend} />
    );
  } else if (serverData) {
    sidebar = (
      <ChannelSidebar
        data={serverData}
        user={user}
        activeChannelId={activeChannel?.id}
        onSelect={selectChannel}
        onCreateChannel={(type) => setModal({ type: "channel", channelType: type })}
        userArea={userArea}
      />
    );
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
      content = <ChatView channel={activeChannel} {...chatProps(activeChannel.id)} />;
    } else {
      content = <div className="empty-state muted">This server has no text channels yet.</div>;
    }
    rightPanel = (
      <MemberList
        members={serverData.members}
        ownerId={serverData.server.ownerId}
        onMemberClick={(m) => setModal({ type: "user", person: m })}
      />
    );
  }

  return (
    <div className="app">
      <ServerRail
        servers={servers ?? []}
        activeId={activeServerId}
        onSelect={setActiveServerId}
        onAdd={() => setModal({ type: "server" })}
        homeBadge={friends.incoming.length + totalUnread}
      />

      {sidebar ? (
        <>
          {sidebar}
          <main className="content">{content}</main>
          {rightPanel}
        </>
      ) : (
        <div className="empty-state">
          <span className="muted">Loading…</span>
        </div>
      )}

      <VoiceAudio peers={voice.peers} />

      {incomingCall && (
        <IncomingCall
          dm={incomingCall}
          onAccept={() => startCall(incomingCall, false)}
          onDecline={() => setDeclinedCalls((set) => new Set(set).add(incomingCall.id))}
        />
      )}

      {modal?.type === "server" && <ServerModal onClose={() => setModal(null)} onDone={onServerAdded} />}
      {modal?.type === "channel" && serverData && (
        <ChannelModal
          serverId={serverData.server.id}
          initialType={modal.channelType}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "profile" && (
        <ProfileModal user={user} onClose={() => setModal(null)} onSaved={onUserChange} />
      )}
      {modal?.type === "user" && (
        <UserProfileModal
          person={modal.person}
          me={user}
          friends={friends}
          onClose={() => setModal(null)}
          onMessage={messageFriend}
          onEditProfile={() => setModal({ type: "profile" })}
        />
      )}
    </div>
  );
}
