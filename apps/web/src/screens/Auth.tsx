import { useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, Fingerprint, Timer } from "lucide-react";
import {
  DISPLAY_NAME_MAX,
  PASSCODE_MIN_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
} from "@lop/config";
import { Button, Field, Wordmark } from "@/ui/kit";
import { ThemeButton } from "@/ui/ThemeButton";
import { Turnstile, turnstileEnabled } from "@/ui/Turnstile";
import { useSession } from "@/state/session";

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= PASSWORD_MIN_LENGTH) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return { score, label: ["Too short", "Okay", "Good", "Strong", "Excellent"][score]! };
}

export function Auth({
  mode,
  onMode,
  onBack,
}: {
  mode: "login" | "register";
  onMode: (m: "login" | "register") => void;
  onBack: () => void;
}) {
  return (
    <div className="relative grid h-full overflow-y-auto bg-bg lg:grid-cols-[1fr_1.1fr]">
      <aside className="glow-lime relative hidden flex-col justify-between overflow-hidden border-r border-line bg-s1 p-10 lg:flex">
        <div className="dotgrid absolute inset-0 opacity-80" />
        <div className="relative">
          <Wordmark size={30} />
        </div>
        <div className="relative max-w-md">
          <h2 className="font-display text-5xl font-extrabold leading-[1] tracking-tight">
            Two secrets.
            <br />
            <span className="text-pop">Zero we can read.</span>
          </h2>
          <ul className="mt-8 space-y-5 text-[15px] text-muted">
            <li className="flex gap-3">
              <Fingerprint className="mt-0.5 shrink-0 text-pop" size={20} />
              <span>
                <b className="text-fg">Your password</b> proves who you are. It is stretched in
                your browser, so we never receive it.
              </span>
            </li>
            <li className="flex gap-3">
              <Timer className="mt-0.5 shrink-0 text-pop" size={20} />
              <span>
                <b className="text-fg">Your vault passcode</b> unlocks your chats on this device.
                One attempt, 30 seconds, every time you open Lop.
              </span>
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-faint">
          Lost your passcode? You can always sign in, but your chats will be cleared. That is
          the point.
        </p>
      </aside>

      <main className="flex min-h-full flex-col px-6 py-6 sm:px-12">
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-muted transition hover:bg-s3 hover:text-fg"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <Wordmark size={24} />
          </div>
          <ThemeButton />
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
          {mode === "login" ? (
            <LoginForm onSwitch={() => onMode("register")} />
          ) : (
            <RegisterForm onSwitch={() => onMode("login")} />
          )}
        </div>
      </main>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
  minLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: string;
  error?: string | null;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Field
        label={label}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        hint={hint}
        error={error}
        minLength={minLength}
        required
        className="[&_input]:pr-12"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide" : "Show"}
        className="absolute right-3 top-[34px] rounded-lg p-1.5 text-faint hover:text-fg"
      >
        {show ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const login = useSession((s) => s.login);
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (turnstileEnabled && !captcha) return setError("Complete the verification first.");
    setBusy(true);
    setError(null);
    try {
      await login({ login: id, password: pw, turnstileToken: captcha ?? undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setResetKey((k) => k + 1);
      setCaptcha(null);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="fade-in space-y-5">
      <div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-muted">
          Sign in, then you'll have 30 seconds and one attempt at your vault passcode.
        </p>
      </div>
      <Field
        label="Email or @username"
        value={id}
        onChange={(e) => setId(e.target.value)}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        autoFocus
      />
      <PasswordField
        label="Account password"
        value={pw}
        onChange={setPw}
        autoComplete="current-password"
      />
      <Turnstile onToken={setCaptcha} resetKey={resetKey} />
      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block busy={busy}>
        {busy ? "Checking…" : "Continue"}
      </Button>
      <p className="text-center text-sm text-muted">
        New to Lop?{" "}
        <button type="button" onClick={onSwitch} className="font-medium text-fg underline decoration-pop decoration-2 underline-offset-4">
          Create an account
        </button>
      </p>
    </form>
  );
}

function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const register = useSession((s) => s.register);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [passcode, setPasscode] = useState("");
  const [passcode2, setPasscode2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const uname = username.trim().toLowerCase().replace(/^@/, "");
  const unameErr = uname && !USERNAME_PATTERN.test(uname) ? "3–32 characters: a–z, 0–9 and _" : null;
  const pwStrength = strength(pw);
  const passcodeErr =
    passcode2 && passcode !== passcode2
      ? "Passcodes don't match"
      : passcode && passcode === pw
        ? "Use a different value than your password"
        : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!USERNAME_PATTERN.test(uname)) return setError("Pick a valid username.");
    if (pw.length < PASSWORD_MIN_LENGTH) {
      return setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
    }
    if (passcode.length < PASSCODE_MIN_LENGTH) {
      return setError(`Vault passcode needs at least ${PASSCODE_MIN_LENGTH} characters.`);
    }
    if (passcodeErr) return setError(passcodeErr);
    if (turnstileEnabled && !captcha) return setError("Complete the verification first.");
    setBusy(true);
    try {
      await register({
        email,
        username: uname,
        displayName,
        password: pw,
        passcode,
        turnstileToken: captcha ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
      setResetKey((k) => k + 1);
      setCaptcha(null);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="fade-in space-y-4">
      <div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Create your account</h1>
        <p className="mt-2 text-muted">Free, and there is no phone number to hand over.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="name"
          required
          autoFocus
        />
        <Field
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="@yourname"
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="username"
          error={unameErr}
          hint="How friends find you"
          required
        />
      </div>
      <Field
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        required
      />
      <div>
        <PasswordField
          label="Account password"
          value={pw}
          onChange={setPw}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
        />
        {pw && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    pwStrength.score >= i ? "bg-pop" : "bg-s3"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs text-muted">{pwStrength.label}</span>
          </div>
        )}
      </div>

      <fieldset className="rounded-2xl border border-lines bg-s1 p-4">
        <legend className="px-2 text-[13px] font-semibold uppercase tracking-wider text-pop">
          Vault passcode
        </legend>
        <p className="mb-3 text-[13px] leading-relaxed text-muted">
          Asked every time you open Lop.{" "}
          <b className="text-fg">One attempt, 30 seconds.</b> A wrong or late answer clears your
          chats and contacts. It never leaves your device and we can't reset it.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <PasswordField
            label="Passcode"
            value={passcode}
            onChange={setPasscode}
            autoComplete="off"
            minLength={PASSCODE_MIN_LENGTH}
          />
          <PasswordField
            label="Repeat passcode"
            value={passcode2}
            onChange={setPasscode2}
            autoComplete="off"
            error={passcodeErr}
          />
        </div>
      </fieldset>

      <Turnstile onToken={setCaptcha} resetKey={resetKey} />
      {error && (
        <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block busy={busy}>
        {busy ? "Generating your keys…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <button type="button" onClick={onSwitch} className="font-medium text-fg underline decoration-pop decoration-2 underline-offset-4">
          Sign in
        </button>
      </p>
    </form>
  );
}
