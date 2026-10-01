import { useState, type FormEvent } from "react";
import { ArrowLeft, EyeOff, KeyRound, TimerOff, Trash2, Hourglass } from "lucide-react";
import { PASSCODE_PATTERN } from "@tetris/config";
import { Button, Field, PasscodeField, Wordmark } from "@/ui/kit";
import { ThemeButton } from "@/ui/ThemeButton";
import { Turnstile, turnstileEnabled } from "@/ui/Turnstile";
import { useSession } from "@/state/session";

const REASONS = {
  WRONG_PASSCODE: {
    icon: EyeOff,
    title: "That passcode didn't match",
    body: "Your chats, contacts and messages on this account have been cleared. Your account and profile are untouched.",
  },
  TIMEOUT: {
    icon: TimerOff,
    title: "Time ran out",
    body: "The 30-second window closed, so your chats, contacts and messages have been cleared. Your account and profile are untouched.",
  },
  EXPIRED: {
    icon: Hourglass,
    title: "Your passcode has expired",
    body: "Confirm the email on file for your account to choose a new 8-digit passcode.",
  },
  REMOTE: {
    icon: Trash2,
    title: "Your chats were cleared",
    body: "A wipe happened on this account. Your account and profile are untouched.",
  },
} as const;

/** Expired passcode: confirm the email on file, then choose a new 8-digit passcode. */
export function Reset() {
  const { resetUsername, notice, reset, cancelReset } = useSession();
  const [username, setUsername] = useState(resetUsername);
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [passcode, setPasscode] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = notice ? REASONS[notice.reason] : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !email.trim()) return setError("Enter your username and email.");
    if (!PASSCODE_PATTERN.test(passcode)) return setError("The passcode is exactly 8 digits.");
    if (passcode !== again) return setError("Passcodes don't match.");
    setBusy(true);
    if (turnstileEnabled && !captcha) {
      setBusy(false);
      return setError("Complete the verification first.");
    }
    try {
      await reset({
        username: username.trim().toLowerCase().replace(/^@/, ""),
        email: email.trim(),
        passcode,
        turnstileToken: captcha ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your passcode");
      setResetKey((k) => k + 1);
      setCaptcha(null);
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-bg">
      <div className="glow-lime pointer-events-none absolute inset-0" />
      <header className="relative flex items-center justify-between px-6 py-5">
        <Wordmark size={26} />
        <div className="flex items-center gap-1">
          <ThemeButton />
          <Button variant="ghost" size="sm" onClick={cancelReset}>
            <ArrowLeft size={15} /> Back
          </Button>
        </div>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-5 pb-10">
        <div className="pop-in w-full max-w-md space-y-4">
          {reason && (
            <div className="flex gap-4 rounded-3xl border border-danger/30 bg-danger/10 p-5">
              <reason.icon className="mt-0.5 shrink-0 text-danger" size={22} />
              <div>
                <h2 className="font-display text-lg font-bold text-danger">{reason.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted">{reason.body}</p>
              </div>
            </div>
          )}

          <form
            onSubmit={submit}
            className="space-y-4 rounded-3xl border border-line bg-s1/90 p-6 shadow-[var(--shadow)] backdrop-blur"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-s3 text-pop">
                <KeyRound size={20} />
              </div>
              <div>
                <h1 className="font-display text-xl font-extrabold">Choose a new passcode</h1>
                <p className="text-sm text-muted">New encryption keys will be created</p>
              </div>
            </div>

            <Field
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <Field
              label="Email on file"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus={!!resetUsername}
            />
            <PasscodeField label="New passcode" value={passcode} onValue={setPasscode} />
            <PasscodeField
              label="Repeat passcode"
              value={again}
              onValue={setAgain}
              hint="Cannot be recovered if you forget it"
            />
            <Turnstile onToken={setCaptcha} resetKey={resetKey} />
            {error && (
              <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" block busy={busy}>
              {busy ? "Generating keys…" : "Set passcode"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}

export function Replaced() {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-5 bg-bg px-6 text-center">
      <div className="glow-lime pointer-events-none absolute inset-0" />
      <div className="relative max-w-sm space-y-4">
        <Wordmark size={30} />
        <h1 className="font-display text-3xl font-extrabold">Opened somewhere else</h1>
        <p className="text-muted">
          This account was unlocked in another browser, which now holds your keys. Tetris supports one
          active device at a time.
        </p>
        <Button size="lg" onClick={() => location.reload()}>
          Use Tetris here instead
        </Button>
      </div>
    </div>
  );
}
