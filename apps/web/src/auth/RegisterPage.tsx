import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { setupVaultOnRegister } from "@/crypto/vaultCrypto";
import type { SessionUser } from "@lop/types";

export function RegisterPage() {
  const navigate = useNavigate();
  const { setSession, markUnlocked } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ user: SessionUser }>("/auth/register", {
        email,
        password,
        username: username.replace(/^@/, "").toLowerCase(),
        displayName,
        vaultPasscodeSetup: true,
      });
      await setupVaultOnRegister(passcode);
      setSession(res.user);
      markUnlocked();
      navigate("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl bg-[var(--lop-panel)] p-6 shadow-xl"
      >
        <h1 className="text-2xl font-semibold">Create account</h1>
        <p className="mt-1 text-sm text-[var(--lop-muted)]">
          Email, password, and a unique @username.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Field label="Email" type="email" value={email} onChange={setEmail} required />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            minLength={12}
          />
          <Field
            label="Username"
            value={username}
            onChange={setUsername}
            required
            placeholder="alice"
          />
          <Field
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            required
          />
          <Field
            label="Vault passcode"
            type="password"
            value={passcode}
            onChange={setPasscode}
            required
            minLength={6}
          />
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-[var(--lop-accent)] px-4 py-3 font-medium text-[#111] disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create account"}
        </button>
        <p className="mt-4 text-center text-sm text-[var(--lop-muted)]">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-left text-sm">
      <span className="text-[var(--lop-muted)]">{props.label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-[var(--lop-border)] bg-[var(--lop-panel-2)] px-3 py-2 outline-none focus:border-[var(--lop-accent)]"
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        required={props.required}
        minLength={props.minLength}
        placeholder={props.placeholder}
      />
    </label>
  );
}
