import { useState, type FormEvent } from "react";
import { EyeOff, LogOut, ShieldCheck, TimerOff, Trash2, KeyRound } from "lucide-react";
import { PASSCODE_MIN_LENGTH } from "@lop/config";
import { Button, Field, Wordmark } from "@/ui/kit";
import { ThemeButton } from "@/ui/ThemeButton";
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
  REMOTE: {
    icon: Trash2,
    title: "Your chats were cleared",
    body: "A wipe happened on this account. Your account and profile are untouched.",
  },
} as const;

/** Shown after a wipe (or first ever setup) to choose the passcode for the new vault. */
export function VaultSetup() {
  const { user, notice, setupVault, logout } = useSession();
  const [passcode, setPasscode] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = notice ? REASONS[notice.reason] : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (passcode.length < PASSCODE_MIN_LENGTH) {
      return setError(`Use at least ${PASSCODE_MIN_LENGTH} characters.`);
    }
    if (passcode !== again) return setError("Passcodes don't match.");
    setBusy(true);
    try {
      await setupVault(passcode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set up your vault");
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
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            <LogOut size={15} /> Sign out
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
                {reason ? <KeyRound size={20} /> : <ShieldCheck size={20} />}
              </div>
              <div>
                <h1 className="font-display text-xl font-extrabold">
                  {reason ? "Start fresh" : "Set your vault passcode"}
                </h1>
                <p className="text-sm text-muted">
                  {user ? `@${user.username}` : ""} · new encryption keys will be created
                </p>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-muted">
              Choose the passcode that unlocks this vault. You can reuse your old one, or pick a
              new one. It never leaves your device.
            </p>

            <Field
              label="Vault passcode"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoComplete="off"
              autoFocus
              required
            />
            <Field
              label="Repeat passcode"
              type="password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              autoComplete="off"
              required
            />
            {error && (
              <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" block busy={busy}>
              {busy ? "Generating keys…" : "Open my empty vault"}
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
          This account was unlocked in another browser, which now holds your keys. Lop supports one
          active device at a time.
        </p>
        <Button size="lg" onClick={() => location.reload()}>
          Use Lop here instead
        </Button>
      </div>
    </div>
  );
}
