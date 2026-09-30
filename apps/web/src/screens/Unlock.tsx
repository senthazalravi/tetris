import { useEffect, useRef, useState, type FormEvent } from "react";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { UNLOCK_WINDOW_MS } from "@lop/config";
import { Button, Ring, Wordmark } from "@/ui/kit";
import { ThemeButton } from "@/ui/ThemeButton";
import { useSession } from "@/state/session";

/**
 * The lock screen. The countdown is driven by performance.now(), so changing
 * the system clock cannot buy extra time; the server owns the real deadline.
 */
export function Unlock() {
  const { user, challenge, unlock, expire } = useSession();
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const expired = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const deadline = challenge?.deadline ?? 0;
  const remaining = Math.max(0, deadline - now);
  const seconds = Math.min(UNLOCK_WINDOW_MS / 1000, Math.ceil(remaining / 1000));
  const attemptUsed = challenge?.attemptUsed ?? false;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Time is up: nothing the user types can help any more.
  useEffect(() => {
    if (!challenge || expired.current) return;
    if (remaining <= 0 && !busy) {
      expired.current = true;
      void expire();
    }
  }, [remaining, busy, challenge, expire]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !passcode || attemptUsed || remaining <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(passcode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock");
      setBusy(false);
    }
  }

  const tone = seconds <= 5 ? "danger" : seconds <= 12 ? "warn" : "pop";

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bg">
      <div className="glow-lime pointer-events-none absolute inset-0" />
      <div className="dotgrid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(60%_60%_at_50%_45%,black,transparent)]" />
      <header className="relative flex items-center justify-between px-6 py-5">
        <Wordmark size={26} />
        <ThemeButton />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-5 pb-10">
        <form
          onSubmit={submit}
          className="pop-in w-full max-w-sm rounded-[2rem] border border-line bg-s1/85 p-8 text-center shadow-[var(--shadow)] backdrop-blur"
        >
          <div className="mb-5 flex justify-center">
            <Ring progress={remaining / UNLOCK_WINDOW_MS} size={168} stroke={9} tone={tone}>
              <div className="flex flex-col items-center">
                <span
                  className={`font-mono text-5xl font-semibold tabular ${
                    tone === "danger" ? "text-danger" : ""
                  }`}
                >
                  {seconds}
                </span>
                <span className="mt-0.5 text-[11px] uppercase tracking-[0.22em] text-muted">
                  seconds
                </span>
              </div>
            </Ring>
          </div>

          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            Unlock your vault
          </h1>
          <p className="mt-1 text-sm text-muted">
            {user ? (
              <>
                Signed in as <b className="text-fg">@{user.username}</b>
              </>
            ) : (
              "Enter your passcode"
            )}
          </p>

          <div className="relative mt-6">
            <LockKeyhole size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={inputRef}
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              disabled={busy || attemptUsed || remaining <= 0}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Vault passcode"
              aria-label="Vault passcode"
              className="h-13 w-full rounded-2xl border border-lines bg-s2 pl-11 pr-4 text-center font-mono text-lg tracking-[0.3em] outline-none transition placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-faint focus:border-pop focus:ring-4 focus:ring-pop/15 disabled:opacity-60"
            />
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            block
            className="mt-4"
            busy={busy}
            disabled={!passcode || attemptUsed || remaining <= 0}
          >
            {busy ? "Unlocking…" : "Unlock"}
          </Button>

          <div className="mt-5 flex items-start gap-2 rounded-2xl bg-s2 px-4 py-3 text-left text-[12.5px] leading-relaxed text-muted">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
            <span>
              <b className="text-fg">One attempt.</b> A wrong passcode, or running out of time,
              permanently clears your chats and contacts. Your account and profile stay.
            </span>
          </div>
        </form>
      </main>
    </div>
  );
}
