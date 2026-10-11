import { useCallback, useEffect, useRef, useState } from "react";

// Voice channels use a WebRTC "mesh": every participant connects directly to every other one.
// The server only relays the connection setup messages (offer / answer / ICE candidates).
// This is good for roughly 2–6 people. For bigger rooms, swap this for an SFU like LiveKit.
//
// Each connection is created with one audio and one video transceiver up front. Turning the
// camera or screen share on and off then just swaps the outgoing video track with replaceTrack(),
// so we never have to renegotiate the connection.

const descToJSON = (d) => ({ type: d.type, sdp: d.sdp });

export function useVoice(socket, iceServers) {
  const [channel, setChannel] = useState(null); // { id, name, serverId, serverName }
  const [participants, setParticipants] = useState([]); // [{ socketId, user, muted, video }]
  const [peers, setPeers] = useState({}); // socketId -> { user, stream, state }
  const [muted, setMuted] = useState(false);
  const [videoMode, setVideoMode] = useState(null); // null | "camera" | "screen"
  const [localVideoStream, setLocalVideoStream] = useState(null);
  const [error, setError] = useState(null);

  const channelRef = useRef(null);
  const joiningRef = useRef(false);
  const micRef = useRef(null); // MediaStream from the microphone
  const videoTrackRef = useRef(null); // current camera or screen track
  const pcsRef = useRef(new Map()); // socketId -> { pc, pending: [], tracks: [] }
  const mutedRef = useRef(false);
  const iceRef = useRef(iceServers);
  iceRef.current = iceServers;

  const audioTrack = () => micRef.current?.getAudioTracks()[0] ?? null;

  const closePeer = useCallback((socketId) => {
    const entry = pcsRef.current.get(socketId);
    if (entry) {
      entry.pc.close();
      pcsRef.current.delete(socketId);
    }
    setPeers((p) => {
      if (!(socketId in p)) return p;
      const { [socketId]: _removed, ...rest } = p;
      return rest;
    });
  }, []);

  const createPeer = useCallback(
    (socketId, user) => {
      closePeer(socketId);
      const pc = new RTCPeerConnection({ iceServers: iceRef.current });
      const entry = { pc, pending: [], tracks: [] };
      pcsRef.current.set(socketId, entry);

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit("voice:signal", { to: socketId, data: { type: "candidate", candidate: e.candidate.toJSON() } });
        }
      };
      pc.ontrack = (e) => {
        entry.tracks.push(e.track);
        // A fresh MediaStream object so React effects re-attach it to <audio>/<video> elements.
        const stream = new MediaStream(entry.tracks);
        setPeers((p) => ({ ...p, [socketId]: { ...p[socketId], user, stream } }));
      };
      pc.onconnectionstatechange = () => {
        setPeers((p) => (p[socketId] ? { ...p, [socketId]: { ...p[socketId], state: pc.connectionState } } : p));
      };

      setPeers((p) => ({ ...p, [socketId]: { user, stream: null, state: "new" } }));
      return entry;
    },
    [socket, closePeer]
  );

  const flushCandidates = async (entry) => {
    const pending = entry.pending;
    entry.pending = [];
    for (const c of pending) await entry.pc.addIceCandidate(c).catch(() => {});
  };

  const cleanup = useCallback(() => {
    for (const { pc } of pcsRef.current.values()) pc.close();
    pcsRef.current.clear();
    setPeers({});
    videoTrackRef.current?.stop();
    videoTrackRef.current = null;
    setLocalVideoStream(null);
    setVideoMode(null);
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    channelRef.current = null;
    joiningRef.current = false;
    setChannel(null);
    setParticipants([]);
  }, []);

  const leave = useCallback(() => {
    if (!channelRef.current) return;
    socket?.emit("voice:leave");
    cleanup();
  }, [socket, cleanup]);

  const join = useCallback(
    async (ch) => {
      if (!socket || joiningRef.current || channelRef.current?.id === ch.id) return;
      if (channelRef.current) leave();
      joiningRef.current = true;
      setError(null);

      try {
        micRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch {
        micRef.current = null;
        setError("No microphone access. You can listen, but others can't hear you.");
      }
      const mic = audioTrack();
      if (mic) mic.enabled = !mutedRef.current;

      channelRef.current = ch;
      setChannel(ch);

      socket.emit("voice:join", { channelId: ch.id, muted: mutedRef.current }, async (res) => {
        joiningRef.current = false;
        if (!res?.ok) {
          cleanup();
          setError(res?.error ?? "Couldn't join voice");
          return;
        }
        if (channelRef.current?.id !== ch.id) return;
        setParticipants(res.participants);

        // We're the newcomer: send an offer to everyone already in the channel.
        for (const peer of res.peers) {
          try {
            const entry = createPeer(peer.socketId, peer.user);
            entry.pc.addTransceiver(audioTrack() ?? "audio", { direction: "sendrecv" });
            entry.pc.addTransceiver(videoTrackRef.current ?? "video", { direction: "sendrecv" });
            await entry.pc.setLocalDescription(await entry.pc.createOffer());
            socket.emit("voice:signal", {
              to: peer.socketId,
              data: { type: "offer", sdp: descToJSON(entry.pc.localDescription) },
            });
          } catch (err) {
            console.error("Failed to call peer", err);
          }
        }
      });
    },
    [socket, leave, cleanup, createPeer]
  );

  // Incoming signaling + room updates.
  useEffect(() => {
    if (!socket) return;

    const onSignal = async ({ from, user, data }) => {
      if (!channelRef.current || !data) return;
      try {
        if (data.type === "offer") {
          const entry = createPeer(from, user);
          await entry.pc.setRemoteDescription(data.sdp);
          await flushCandidates(entry);
          // Attach our mic/video to the transceivers the offer created, then answer.
          for (const t of entry.pc.getTransceivers()) {
            t.direction = "sendrecv";
            await t.sender.replaceTrack(t.receiver.track.kind === "audio" ? audioTrack() : videoTrackRef.current);
          }
          await entry.pc.setLocalDescription(await entry.pc.createAnswer());
          socket.emit("voice:signal", {
            to: from,
            data: { type: "answer", sdp: descToJSON(entry.pc.localDescription) },
          });
          return;
        }

        const entry = pcsRef.current.get(from);
        if (!entry) return;
        if (data.type === "answer") {
          await entry.pc.setRemoteDescription(data.sdp);
          await flushCandidates(entry);
        } else if (data.type === "candidate") {
          if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(data.candidate).catch(() => {});
          else entry.pending.push(data.candidate);
        }
      } catch (err) {
        console.error("Voice signaling error", err);
      }
    };

    const onPeerLeft = ({ socketId }) => closePeer(socketId);

    const onState = ({ channelId, participants }) => {
      if (channelRef.current?.id === channelId) setParticipants(participants);
    };

    const onDisconnect = () => {
      if (!channelRef.current) return;
      cleanup();
      setError("Lost connection, so you were disconnected from voice.");
    };

    socket.on("voice:signal", onSignal);
    socket.on("voice:peer-left", onPeerLeft);
    socket.on("voice:state", onState);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("voice:signal", onSignal);
      socket.off("voice:peer-left", onPeerLeft);
      socket.off("voice:state", onState);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket, createPeer, closePeer, cleanup]);

  // Release the mic/camera when the component using this hook unmounts (e.g. on logout).
  useEffect(() => cleanup, [cleanup]);

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    const mic = audioTrack();
    if (mic) mic.enabled = !next;
    if (channelRef.current) socket?.emit("voice:update", { muted: next });
  }, [socket]);

  const setVideoTrack = useCallback(
    (track, mode) => {
      const old = videoTrackRef.current;
      videoTrackRef.current = track;
      if (old && old !== track) old.stop();
      for (const { pc } of pcsRef.current.values()) {
        const t = pc.getTransceivers().find((t) => t.receiver.track.kind === "video");
        t?.sender.replaceTrack(track).catch(() => {});
      }
      setLocalVideoStream(track ? new MediaStream([track]) : null);
      setVideoMode(track ? mode : null);
      socket?.emit("voice:update", { video: !!track });
    },
    [socket]
  );

  const toggleCamera = useCallback(async () => {
    if (!channelRef.current) return;
    if (videoMode === "camera") return setVideoTrack(null, null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const track = stream.getVideoTracks()[0];
      if (!channelRef.current) return track.stop();
      setVideoTrack(track, "camera");
    } catch {
      setError("Couldn't access your camera.");
    }
  }, [videoMode, setVideoTrack]);

  const toggleScreen = useCallback(async () => {
    if (!channelRef.current) return;
    if (videoMode === "screen") return setVideoTrack(null, null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      if (!channelRef.current) return track.stop();
      // Fires when the user clicks the browser's own "Stop sharing" button.
      track.onended = () => {
        if (videoTrackRef.current === track) setVideoTrack(null, null);
      };
      setVideoTrack(track, "screen");
    } catch {
      // User cancelled the screen picker.
    }
  }, [videoMode, setVideoTrack]);

  return {
    channel,
    participants: participants.map((p) => ({ ...p, isSelf: p.socketId === socket?.id })),
    peers,
    muted,
    videoMode,
    localVideoStream,
    error,
    clearError: () => setError(null),
    join,
    leave,
    toggleMute,
    toggleCamera,
    toggleScreen,
  };
}
