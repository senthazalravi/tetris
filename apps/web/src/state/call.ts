import { create } from "zustand";
import type {
  CallSignalKind,
  ConversationDto,
  RealtimeEvent,
} from "@tetris/types";
import { api } from "@/lib/api";
import { callSecurityCode, sdpFingerprint } from "@/lib/callcode";
import {
  showIncomingNotification,
  startRingtone,
  stopRingtone,
} from "@/lib/notify";
import { nameOf, sendCallLog, toast, useChat } from "./chat";

/**
 * One-to-one voice calls over WebRTC. Audio goes straight between the two
 * browsers (encrypted by WebRTC, DTLS-SRTP); the server only relays the small
 * setup messages. No media server, no paid service: STUN is free and public.
 */

export type CallPhase =
  "idle" | "calling" | "ringing" | "connecting" | "connected";

interface CallState {
  phase: CallPhase;
  direction: "out" | "in" | null;
  callId: string | null;
  peerId: string | null;
  peerName: string;
  peerAvatar: { seed: string; url: string | null; name: string } | null;
  convId: string | null;
  muted: boolean;
  connectedAt: number | null;
  /** Short code both people can read out to confirm nobody is in the middle. */
  code: string | null;
}

const IDLE: CallState = {
  phase: "idle",
  direction: null,
  callId: null,
  peerId: null,
  peerName: "",
  peerAvatar: null,
  convId: null,
  muted: false,
  connectedAt: null,
  code: null,
};

export const useCall = create<CallState>(() => ({ ...IDLE }));
const set = useCall.setState;
const get = useCall.getState;

const RING_MS = 45_000;
const FALLBACK_ICE: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
];

let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let pendingOffer: string | null = null;
let pendingCandidates: RTCIceCandidateInit[] = [];
/** Candidates that arrive before we know about the call (they can overtake the offer). */
let earlyCandidates = new Map<string, RTCIceCandidateInit[]>();
let remoteReady = false;
let signalGate: Promise<unknown> = Promise.resolve();
let ringTimer: number | undefined;
let lostTimer: number | undefined;
let audioEl: HTMLAudioElement | null = null;
let iceCache: RTCIceServer[] | null = null;

const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("tetris-call")
    : null;
channel?.addEventListener(
  "message",
  (ev: MessageEvent<{ type: string; callId: string }>) => {
    // Another tab of this browser answered or declined: stop ringing here, quietly.
    const s = get();
    if (
      ev.data?.type === "handled" &&
      s.phase === "ringing" &&
      s.callId === ev.data.callId
    ) {
      teardown();
    }
  },
);

function newCallId() {
  return `call_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function signal(
  to: string,
  callId: string,
  kind: CallSignalKind,
  data?: unknown,
): Promise<{ delivered: number }> {
  return api.post<{ delivered: number }>("/calls/signal", {
    to,
    callId,
    kind,
    data,
  });
}

function remoteAudio(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    audioEl.setAttribute("playsinline", "");
    document.body.appendChild(audioEl);
  }
  return audioEl;
}

async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache) return iceCache;
  try {
    const res = await api.get<{ iceServers: RTCIceServer[] }>("/calls/ice");
    iceCache = res.iceServers.length ? res.iceServers : FALLBACK_ICE;
  } catch {
    iceCache = FALLBACK_ICE;
  }
  return iceCache;
}

async function microphone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot make voice calls.");
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (e) {
    const denied =
      e instanceof DOMException &&
      (e.name === "NotAllowedError" || e.name === "SecurityError");
    throw new Error(
      denied
        ? "Microphone access is blocked. Allow it in your browser to make calls."
        : "No microphone was found.",
    );
  }
}

function buildPeer(
  servers: RTCIceServer[],
  to: string,
  callId: string,
): RTCPeerConnection {
  const conn = new RTCPeerConnection({ iceServers: servers });
  conn.onicecandidate = (e) => {
    if (!e.candidate) return;
    const init = e.candidate.toJSON();
    // Wait for the offer or answer to be sent first so a candidate never arrives before it.
    void signalGate
      .then(() => signal(to, callId, "candidate", { candidate: init }))
      .catch(() => {});
  };
  conn.ontrack = (e) => {
    const el = remoteAudio();
    el.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    void el.play().catch(() => {});
  };
  conn.onconnectionstatechange = () => {
    if (pc !== conn) return;
    const st = conn.connectionState;
    if (st === "connected") {
      window.clearTimeout(lostTimer);
      window.clearTimeout(ringTimer);
      if (get().phase !== "connected") {
        set({ phase: "connected", connectedAt: Date.now() });
        void deriveCode(conn);
      }
    } else if (st === "disconnected") {
      // Brief network blips recover on their own; give it a few seconds.
      window.clearTimeout(lostTimer);
      lostTimer = window.setTimeout(() => endAfterLoss(conn), 8_000);
    } else if (st === "failed") {
      endAfterLoss(conn);
    }
  };
  return conn;
}

async function deriveCode(conn: RTCPeerConnection) {
  const local = conn.localDescription?.sdp;
  const remote = conn.remoteDescription?.sdp;
  const a = local ? sdpFingerprint(local) : null;
  const b = remote ? sdpFingerprint(remote) : null;
  if (!a || !b) return;
  const code = await callSecurityCode(a, b);
  if (pc === conn) set({ code });
}

function endAfterLoss(conn: RTCPeerConnection) {
  if (pc !== conn) return;
  const s = get();
  if (s.direction === "out")
    logCall(s.phase === "connected" ? "ended" : "missed");
  teardown("The call lost its connection.");
}

function connectedFor(): number {
  const at = get().connectedAt;
  return at ? Math.max(0, Date.now() - at) : 0;
}

/** Only the caller writes the call into the chat, so it is recorded exactly once. */
function logCall(status: "missed" | "declined" | "ended", durationMs?: number) {
  const s = get();
  if (s.direction !== "out" || !s.convId) return;
  void sendCallLog(s.convId, {
    status,
    ...(status === "ended" ? { durationMs: durationMs ?? connectedFor() } : {}),
  });
}

async function flushCandidates() {
  remoteReady = true;
  const list = pendingCandidates;
  pendingCandidates = [];
  for (const c of list) {
    try {
      await pc?.addIceCandidate(c);
    } catch {
      /* a stale candidate is harmless */
    }
  }
}

/** Stop everything and return to idle. `notice` is shown as a short message. */
function teardown(notice?: string) {
  window.clearTimeout(ringTimer);
  window.clearTimeout(lostTimer);
  stopRingtone();
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  const conn = pc;
  pc = null;
  conn?.close();
  if (audioEl) audioEl.srcObject = null;
  pendingOffer = null;
  pendingCandidates = [];
  remoteReady = false;
  signalGate = Promise.resolve();
  set({ ...IDLE });
  if (notice) toast(notice);
}

/** Leave the engine tidy (signing out, wipe, tab closing). */
export function resetCall() {
  earlyCandidates = new Map();
  if (get().phase !== "idle") teardown();
}

/* ------------------------------------------------------------------ */
/* placing a call                                                       */
/* ------------------------------------------------------------------ */

export async function startCall(conv: ConversationDto) {
  if (conv.group) return;
  if (get().phase !== "idle") return;
  const peer = conv.peer;
  const callId = newCallId();
  set({
    ...IDLE,
    phase: "calling",
    direction: "out",
    callId,
    peerId: peer.userId,
    peerName: nameOf(useChat.getState().nicknames, peer),
    peerAvatar: {
      seed: peer.userId,
      url: peer.avatarUrl,
      name: peer.displayName,
    },
    convId: conv.id,
  });
  try {
    localStream = await microphone();
    const servers = await iceServers();
    const conn = buildPeer(servers, peer.userId, callId);
    pc = conn;
    for (const t of localStream.getTracks()) conn.addTrack(t, localStream);
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);

    const sending = signal(peer.userId, callId, "offer", { sdp: offer.sdp });
    signalGate = sending;
    const res = await sending;
    if (get().callId !== callId) return; // hung up while it was being sent
    if (!res.delivered) {
      logCall("missed");
      teardown(`${get().peerName} is not available right now.`);
      return;
    }
    ringTimer = window.setTimeout(() => {
      if (get().callId !== callId || get().phase !== "calling") return;
      void signal(peer.userId, callId, "hangup").catch(() => {});
      logCall("missed");
      teardown(`${get().peerName} did not answer.`);
    }, RING_MS);
  } catch (e) {
    if (get().callId === callId) {
      teardown(e instanceof Error ? e.message : "Could not start the call.");
    }
  }
}

/* ------------------------------------------------------------------ */
/* answering                                                            */
/* ------------------------------------------------------------------ */

export async function acceptCall() {
  const s = get();
  if (s.phase !== "ringing" || !s.callId || !s.peerId || !pendingOffer) return;
  const { callId, peerId } = s;
  stopRingtone();
  window.clearTimeout(ringTimer);
  channel?.postMessage({ type: "handled", callId });
  set({ phase: "connecting" });
  try {
    localStream = await microphone();
    const servers = await iceServers();
    const conn = buildPeer(servers, peerId, callId);
    pc = conn;
    for (const t of localStream.getTracks()) conn.addTrack(t, localStream);
    await conn.setRemoteDescription({ type: "offer", sdp: pendingOffer });
    await flushCandidates();
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    const sending = signal(peerId, callId, "answer", { sdp: answer.sdp });
    signalGate = sending;
    await sending;
  } catch (e) {
    void signal(peerId, callId, "decline").catch(() => {});
    teardown(e instanceof Error ? e.message : "Could not answer the call.");
  }
}

export function declineCall() {
  const s = get();
  if (s.phase !== "ringing" || !s.callId || !s.peerId) return;
  channel?.postMessage({ type: "handled", callId: s.callId });
  void signal(s.peerId, s.callId, "decline").catch(() => {});
  teardown();
}

/** Hang up, or cancel a call that has not been answered yet. */
export function hangUp() {
  const s = get();
  if (s.phase === "idle" || !s.callId || !s.peerId) return;
  if (s.phase === "ringing") return declineCall();
  void signal(s.peerId, s.callId, "hangup").catch(() => {});
  if (s.direction === "out")
    logCall(s.phase === "connected" ? "ended" : "missed");
  teardown();
}

export function toggleMute() {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  set({ muted: !track.enabled });
}

/* ------------------------------------------------------------------ */
/* incoming signals                                                     */
/* ------------------------------------------------------------------ */

type CallSignal = Extract<RealtimeEvent, { type: "call.signal" }>;

function sdpOf(data: unknown): string | null {
  const sdp = (data as { sdp?: unknown } | undefined)?.sdp;
  return typeof sdp === "string" ? sdp : null;
}

export async function handleCallSignal(ev: CallSignal) {
  const s = get();

  if (ev.kind === "offer") {
    const offer = sdpOf(ev.data);
    if (!offer) return;
    // The same offer can be delivered more than once; it is still one call.
    if (s.callId === ev.callId) return;
    if (s.phase !== "idle") {
      void signal(ev.from, ev.callId, "busy").catch(() => {});
      return;
    }
    const conv = useChat
      .getState()
      .conversations.find((c) => !c.group && c.peer.userId === ev.from);
    if (!conv) {
      void signal(ev.from, ev.callId, "decline").catch(() => {});
      return;
    }
    pendingOffer = offer;
    pendingCandidates = earlyCandidates.get(ev.callId) ?? [];
    earlyCandidates.delete(ev.callId);
    const name = nameOf(useChat.getState().nicknames, conv.peer);
    set({
      ...IDLE,
      phase: "ringing",
      direction: "in",
      callId: ev.callId,
      peerId: ev.from,
      peerName: name,
      peerAvatar: {
        seed: conv.peer.userId,
        url: conv.peer.avatarUrl,
        name: conv.peer.displayName,
      },
      convId: conv.id,
    });
    startRingtone();
    showIncomingNotification(`${name} is calling you`, "tetris-call", {
      requireInteraction: true,
    });
    // The caller gives up after 45s and sends a hang-up; this only covers a lost message.
    ringTimer = window.setTimeout(() => {
      if (get().callId === ev.callId && get().phase === "ringing") {
        teardown(`Missed call from ${name}.`);
      }
    }, RING_MS + 8_000);
    return;
  }

  if (ev.kind === "candidate") {
    const cand = (ev.data as { candidate?: RTCIceCandidateInit } | undefined)
      ?.candidate;
    if (!cand) return;
    if (s.callId === ev.callId && pc && remoteReady) {
      try {
        await pc.addIceCandidate(cand);
      } catch {
        /* ignore */
      }
    } else if (s.callId === ev.callId) {
      pendingCandidates.push(cand);
    } else {
      const list = earlyCandidates.get(ev.callId) ?? [];
      if (list.length < 64) list.push(cand);
      earlyCandidates.set(ev.callId, list);
      if (earlyCandidates.size > 8)
        earlyCandidates.delete(earlyCandidates.keys().next().value!);
    }
    return;
  }

  // Everything below only concerns the call we are in.
  if (s.callId !== ev.callId || s.peerId !== ev.from) return;

  if (ev.kind === "answer") {
    const sdp = sdpOf(ev.data);
    if (!sdp || !pc || s.direction !== "out" || s.phase !== "calling") return;
    window.clearTimeout(ringTimer);
    set({ phase: "connecting" });
    try {
      await pc.setRemoteDescription({ type: "answer", sdp });
      await flushCandidates();
    } catch {
      logCall("missed");
      teardown("Could not connect the call.");
    }
    return;
  }

  if (ev.kind === "decline") {
    logCall("declined");
    teardown(`${s.peerName} declined the call.`);
    return;
  }
  if (ev.kind === "busy") {
    logCall("missed");
    teardown(`${s.peerName} is on another call.`);
    return;
  }
  if (ev.kind === "hangup") {
    if (s.direction === "out")
      logCall(s.phase === "connected" ? "ended" : "missed");
    teardown(
      s.phase === "ringing"
        ? `Missed call from ${s.peerName}.`
        : "The call ended.",
    );
  }
}
