import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import type { SessionUser } from "@lop/types";

export function LoginPage() {
  const navigate = useNavigate();
  const { setSession, beginUnlock } = useAuth();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{
        user: SessionUser;
        unlockChallengeId: string;
        unlockExpiresAt: number;
      }>("/auth/login", { login, password });
      setSession(res.user);
      beginUnlock(res.unlockChallengeId, res.unlockExpiresAt);
      navigate("/unlock");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
        <h1 className="text-2xl font-semibold">Log in</h1>
        <p className="mt-1 text-sm text-[var(--lop-muted)]">
          Email or username, then your vault passcode.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <label className="block text-sm">
            <span className="text-[var(--lop-muted)]">Email or username</span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--lop-border)] bg-[var(--lop-panel-2)] px-3 py-2 outline-none focus:border-[var(--lop-accent)]"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--lop-muted)]">Password</span>
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-[var(--lop-border)] bg-[var(--lop-panel-2)] px-3 py-2 outline-none focus:border-[var(--lop-accent)]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-lg bg-[var(--lop-accent)] px-4 py-3 font-medium text-[#111] disabled:opacity-60"
        >
          {busy ? "Signing in…" : "Continue"}
        </button>
        <p className="mt-4 text-center text-sm text-[var(--lop-muted)]">
          New here? <Link to="/register">Create account</Link>
        </p>
      </form>
    </div>
  );
}
