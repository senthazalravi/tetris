import { useEffect, useRef, useState, type FormEvent } from "react";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { PASSCODE_LENGTH, PASSCODE_PATTERN, UNLOCK_WINDOW_MS } from "@tetris/config";
import { Button, Ring, Wordmark } from "@/ui/kit";
import { SiteFooter, type LegalPageId } from "@/ui/SiteFooter";
import { InstallButton } from "@/ui/InstallButton";
import { ThemeButton } from "@/ui/ThemeButton";
import { Turnstile, turnstileEnabled } from "@/ui/Turnstile";
import { useSession } from "@/state/session";

/**
 * The first screen everyone sees: a 30 second countdown with a username and an
 * 8-digit passcode. With a live session (a refresh) the clock is the server's
 * challenge and running out wipes your chats. With no session it is a local
 * clock that simply expires, because there is nothing to wipe yet.
 */
export function Login({ onOpenLegal }: { onOpenLegal: (id: LegalPageId) => void }) {
  const { phase, user, challenge, start, unlock, expire, openReset } = useSession();
  const locked = phase === "locked";

  const [username, setUsername] = useState("");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only a failed attempt or a lapsed clock earns the "forgot passcode" option.
  const [failed, setFailed] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [now, setNow] = useState(() => performance.now());
  // Local deadline for visitors without a session.
  const [localDeadline, setLocalDeadline] = useState(() => performance.now() + UNLOCK_WINDOW_MS);
  const expired = useRef(false);
  const userRef = useRef<HTMLInputElement>(null);

  const deadline = locked ? (challenge?.deadline ?? 0) : localDeadline;
  const remaining = Math.max(0, deadline - now);
  const seconds = Math.min(UNLOCK_WINDOW_MS / 1000, Math.ceil(remaining / 1000));
  const attemptUsed = challenge?.attemptUsed ?? false;
  const timeUp = remaining <= 0;
  const disabled = busy || timeUp || (locked && attemptUsed);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Server challenge ran out: nothing typed now can help; your chats are wiped.
  useEffect(() => {
    if (!locked || !challenge || expired.current) return;
    if (remaining <= 0 && !busy) {
      expired.current = true;
      void expire();
    }
  }, [locked, remaining, busy, challenge, expire]);

  useEffect(() => {
    userRef.current?.focus();
  }, []);

  function startOver() {
    setLocalDeadline(performance.now() + UNLOCK_WINDOW_MS);
    setPasscode("");
    setError(null);
    setFailed(false);
    userRef.current?.focus();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const typed = username.trim().toLowerCase().replace(/^@/, "");
    if (!typed) return setError("Enter your username.");
    // A typo in the username must not burn the one attempt.
    if (locked && user && typed !== user.username) {
      return setError("That is not the username on this session.");
    }
    if (!PASSCODE_PATTERN.test(passcode)) {
      return setError(`The passcode is exactly ${PASSCODE_LENGTH} digits.`);
    }
    if (!locked && turnstileEnabled && !captcha)
      return setError("Complete the verification first.");
    setBusy(true);
    setError(null);
    try {
      if (locked) await unlock(passcode);
      else await start({ username: typed, passcode, turnstileToken: captcha ?? undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setFailed(true);
      setPasscode("");
      setResetKey((k) => k + 1);
      setCaptcha(null);
      setBusy(false);
    }
  }

  const tone = seconds <= 5 ? "danger" : seconds <= 12 ? "warn" : "pop";

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-bg">
      <header className="relative flex items-center justify-between px-6 py-5">
        <Wordmark size={26} />
        <div className="flex items-center gap-2">
          <InstallButton />
          <ThemeButton />
        </div>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-5 py-4">
        <form
          onSubmit={submit}
          className="panel pop-in w-full max-w-sm rounded-3xl p-9 text-center shadow-[var(--shadow)]"
        >
          <div className="mb-5 flex justify-center">
            <Ring progress={remaining / UNLOCK_WINDOW_MS} size={156} stroke={3} tone={tone}>
              <div className="flex flex-col items-center">
                <span
                  className={`font-display text-6xl leading-none tabular-nums ${tone === "danger" ? "text-danger" : ""}`}
                >
                  {seconds}
                </span>
                <span className="mt-0.5 text-[11px] uppercase tracking-[0.22em] text-muted">
                  seconds
                </span>
              </div>
            </Ring>
          </div>

          <h1 className="font-display text-[36px] leading-none">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">Enter your username and passcode.</p>

          <input
            ref={userRef}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={disabled}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Username"
            aria-label="Username"
            className="mt-6 h-13 w-full rounded-2xl border border-lines bg-s2 px-4 text-center text-base outline-none transition placeholder:text-faint focus:border-pop focus:ring-4 focus:ring-pop/15 disabled:opacity-60"
          />
          <div className="relative mt-3">
            <LockKeyhole
              size={17}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              type="password"
              inputMode="numeric"
              pattern="\d*"
              maxLength={PASSCODE_LENGTH}
              value={passcode}
              onChange={(e) =>
                setPasscode(e.target.value.replace(/\D/g, "").slice(0, PASSCODE_LENGTH))
              }
              disabled={disabled}
              autoComplete="off"
              placeholder="8-digit passcode"
              aria-label="Passcode"
              className="h-13 w-full rounded-2xl border border-lines bg-s2 pl-11 pr-4 text-center font-mono text-lg tracking-[0.3em] outline-none transition placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:text-faint focus:border-pop focus:ring-4 focus:ring-pop/15 disabled:opacity-60"
            />
          </div>

          {!locked && <Turnstile onToken={setCaptcha} resetKey={resetKey} />}

          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {timeUp && !locked && (
            <p role="status" className="mt-3 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
              Time is up.
            </p>
          )}

          {timeUp && !locked ? (
            <Button type="button" size="lg" block className="mt-4" onClick={startOver}>
              Start over
            </Button>
          ) : (
            <Button
              type="submit"
              size="lg"
              block
              className="mt-4"
              busy={busy}
              disabled={disabled || !username || passcode.length !== PASSCODE_LENGTH}
            >
              {busy ? "Checking…" : "Enter"}
            </Button>
          )}

          {(timeUp || failed) && (
            <button
              type="button"
              onClick={() =>
                openReset(username.trim().toLowerCase().replace(/^@/, "") || user?.username)
              }
              className="mt-4 text-sm text-muted underline-offset-4 transition hover:text-fg hover:underline"
            >
              Forgot your passcode? Confirm your email to set a new one
            </button>
          )}

          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-s2 px-4 py-3 text-left text-[12.5px] leading-relaxed text-muted">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
            <span>
              <b className="text-fg">One attempt.</b> A wrong passcode, or running out of time,
              clears your chats and contacts and expires the passcode.
            </span>
          </div>
        </form>
      </main>
      <SiteFooter onOpenLegal={onOpenLegal} />
    </div>
  );
}
