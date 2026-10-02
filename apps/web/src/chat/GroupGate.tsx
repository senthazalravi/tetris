import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { GROUP_CODE_LENGTH } from "@tetris/config";
import type { ConversationDto } from "@tetris/types";
import { ApiError, api } from "@/lib/api";
import { refreshConversations, selectConversation } from "@/state/chat";
import { useSession } from "@/state/session";
import { Button } from "@/ui/kit";

type View = "loading" | "ask" | "denied" | "error";

/**
 * Shown the first time someone opens a group. They get 30 seconds and two tries
 * at the four-digit code. A right code opens the group for good (it is never
 * asked again); anything else closes the group to them for good. The server
 * keeps the clock and the count, this is only the form.
 */
export function GroupGate({ conv }: { conv: ConversationDto }) {
  const setScreen = useSession((s) => s.setScreen);
  const [view, setView] = useState<View>("loading");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [triesLeft, setTriesLeft] = useState(2);
  const [endsAt, setEndsAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);

  const name = conv.group?.name ?? conv.peer.displayName;
  const secondsLeft = Math.max(0, Math.ceil((endsAt - now) / 1000));

  function lockOut(message: string) {
    setNote(message);
    setView("denied");
    // The server drops the group from the list once its clock has run out.
    window.setTimeout(() => void refreshConversations().catch(() => {}), 4_000);
  }

  useEffect(() => {
    let live = true;
    api
      .post<{ access: string; remainingMs?: number; attemptsLeft?: number }>(
        `/groups/${conv.id}/unlock/start`,
      )
      .then(async (res) => {
        if (!live) return;
        if (res.access === "granted") {
          await refreshConversations();
          return;
        }
        setEndsAt(Date.now() + (res.remainingMs ?? 0));
        setTriesLeft(res.attemptsLeft ?? 2);
        setView("ask");
      })
      .catch((e) => {
        if (!live) return;
        if (e instanceof ApiError && e.data?.access === "denied") {
          lockOut("You can't open this group.");
        } else {
          setNote(e instanceof Error ? e.message : "Could not open the group.");
          setView("error");
        }
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id]);

  // The clock.
  useEffect(() => {
    if (view !== "ask") return;
    input.current?.focus();
    const t = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= endsAt) lockOut("Time is up. This group is closed to you.");
    }, 250);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, endsAt]);

  async function submit(value: string) {
    if (busy || value.length !== GROUP_CODE_LENGTH) return;
    setBusy(true);
    setNote("");
    try {
      const res = await api.post<{ ok: boolean; attemptsLeft?: number }>(
        `/groups/${conv.id}/unlock`,
        { code: value },
      );
      if (res.ok) {
        await refreshConversations();
        return;
      }
      setTriesLeft(res.attemptsLeft ?? 0);
      setNote(
        `Wrong code. ${res.attemptsLeft === 1 ? "One try left." : `${res.attemptsLeft} tries left.`}`,
      );
      setCode("");
      input.current?.focus();
    } catch (e) {
      if (e instanceof ApiError && e.data?.denied) {
        lockOut("That was not the code. This group is closed to you.");
      } else {
        setNote(e instanceof Error ? e.message : "Could not check the code.");
      }
    } finally {
      setBusy(false);
    }
  }
  function leave() {
    selectConversation(null);
    setScreen("game");
    void refreshConversations().catch(() => {});
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Open ${name}`}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4"
    >
      <div className="panel pop-in w-full max-w-sm rounded-3xl p-9 text-center shadow-[var(--shadow)]">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-s3 text-muted">
          <Lock size={26} />
        </div>
        <h2 className="font-display text-4xl leading-tight">{name}</h2>

        {view === "loading" && (
          <p className="mt-3 text-sm text-muted">One moment…</p>
        )}

        {view === "ask" && (
          <>
            <p className="mt-1.5 text-sm text-muted">
              Enter the {GROUP_CODE_LENGTH}-digit group code. You have one go at
              this: two tries, and the time below.
            </p>
            <input
              ref={input}
              type="password"
              inputMode="numeric"
              pattern="\d*"
              maxLength={GROUP_CODE_LENGTH}
              value={code}
              disabled={busy}
              autoComplete="off"
              aria-label="Group code"
              onChange={(e) => {
                const v = e.target.value
                  .replace(/\D/g, "")
                  .slice(0, GROUP_CODE_LENGTH);
                setCode(v);
                if (v.length === GROUP_CODE_LENGTH) void submit(v);
              }}
              className="mt-6 h-14 w-full rounded-2xl border border-lines bg-s2 text-center font-mono text-2xl tracking-[0.5em] outline-none transition focus:border-pop focus:ring-4 focus:ring-pop/15 disabled:opacity-60"
            />
            <p className="mt-3 text-sm tabular-nums text-muted" aria-live="off">
              {secondsLeft}s left ·{" "}
              {triesLeft === 1 ? "1 try" : `${triesLeft} tries`}
            </p>
            {note && (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {note}
              </p>
            )}
          </>
        )}

        {(view === "denied" || view === "error") && (
          <>
            <p role="alert" className="mt-3 text-sm text-muted">
              {note}
            </p>
            <Button className="mt-6" block onClick={leave}>
              Close
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
