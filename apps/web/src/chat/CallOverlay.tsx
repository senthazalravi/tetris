import { useEffect, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, ShieldCheck } from "lucide-react";
import {
  acceptCall,
  declineCall,
  hangUp,
  toggleMute,
  useCall,
} from "@/state/call";
import { Avatar } from "@/ui/kit";

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The call window. It sits above everything (game, chat, profile) so an
 * incoming call can never be missed while the tab is open.
 */
export function CallOverlay() {
  const call = useCall();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (call.phase !== "connected") return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [call.phase]);

  if (call.phase === "idle") return null;

  const incoming = call.phase === "ringing";
  const status =
    call.phase === "calling"
      ? "Calling…"
      : call.phase === "ringing"
        ? "is calling you"
        : call.phase === "connecting"
          ? "Connecting…"
          : clock(now - (call.connectedAt ?? now));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        incoming
          ? `Incoming call from ${call.peerName}`
          : `Call with ${call.peerName}`
      }
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4"
    >
      <div className="panel pop-in w-full max-w-sm rounded-3xl p-9 text-center shadow-[var(--shadow)]">
        {call.peerAvatar && (
          <div className="mb-5 flex justify-center">
            <Avatar
              name={call.peerAvatar.name}
              seed={call.peerAvatar.seed}
              url={call.peerAvatar.url}
              size={96}
            />
          </div>
        )}
        <h2 className="font-display text-4xl leading-tight">{call.peerName}</h2>
        <p
          className="mt-1.5 text-sm text-muted tabular-nums"
          aria-live="polite"
        >
          {status}
        </p>

        {call.phase === "connected" && call.code && (
          <p className="mx-auto mt-5 flex max-w-[16rem] items-start justify-center gap-2 text-xs leading-relaxed text-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-pop" />
            <span>
              Call code <span className="font-mono text-fg">{call.code}</span>
              <br />
              Read it out: if you both see the same code, nobody is listening
              in.
            </span>
          </p>
        )}

        <div className="mt-8 flex items-center justify-center gap-5">
          {incoming ? (
            <>
              <RoundButton label="Decline" tone="danger" onClick={declineCall}>
                <PhoneOff size={22} />
              </RoundButton>
              <RoundButton
                label="Accept"
                tone="accept"
                onClick={() => void acceptCall()}
              >
                <Phone size={22} />
              </RoundButton>
            </>
          ) : (
            <>
              {call.phase !== "calling" && (
                <RoundButton
                  label={call.muted ? "Unmute" : "Mute"}
                  tone={call.muted ? "active" : "plain"}
                  onClick={toggleMute}
                >
                  {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
                </RoundButton>
              )}
              <RoundButton
                label={call.phase === "calling" ? "Cancel" : "Hang up"}
                tone="danger"
                onClick={hangUp}
              >
                <PhoneOff size={22} />
              </RoundButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RoundButton({
  label,
  tone,
  onClick,
  children,
}: {
  label: string;
  tone: "danger" | "accept" | "plain" | "active";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const colors = {
    danger: "bg-danger text-white hover:brightness-110",
    accept: "bg-[#2f9e5b] text-white hover:brightness-110",
    plain: "bg-s3 text-fg hover:bg-s4",
    active: "bg-fg text-bg hover:opacity-90",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full transition active:scale-95 ${colors}`}
    >
      {children}
    </button>
  );
}
