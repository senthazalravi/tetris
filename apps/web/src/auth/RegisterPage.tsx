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
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-8 text-text">
      <div className="w-full max-w-md">
        <h1 className="font-brand mb-2 text-4xl font-bold">Lop</h1>
        <h2 className="mb-8 text-3xl font-bold">Signup</h2>
        <form onSubmit={onSubmit} className="flex flex-col gap-y-4">
          <Field
            placeholder="Email"
            type="email"
            value={email}
            onChange={setEmail}
            required
          />
          <Field
            placeholder="Password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            minLength={12}
          />
          <Field
            placeholder="Username"
            value={username}
            onChange={setUsername}
            required
          />
          <Field
            placeholder="Display name"
            value={displayName}
            onChange={setDisplayName}
            required
          />
          <Field
            placeholder="Vault passcode"
            type="password"
            value={passcode}
            onChange={setPasscode}
            required
            minLength={6}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-2 w-full rounded bg-primary px-6 py-3 font-medium text-white shadow-lg disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create account"}
          </button>
          <p className="text-sm text-secondary-darker">
            Already have an account?{" "}
            <Link className="text-primary" to="/login">
              Login
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

function Field(props: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <input
      className="rounded bg-background p-3 text-text outline outline-1 outline-secondary-dark hover:outline-primary"
      type={props.type ?? "text"}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      required={props.required}
      minLength={props.minLength}
    />
  );
}
