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
    <div className="flex min-h-full items-center justify-center bg-background px-4 text-text">
      <div className="w-full max-w-md">
        <h1 className="font-brand mb-2 text-4xl font-bold">Lop</h1>
        <h2 className="mb-8 text-3xl font-bold">Login</h2>
        <form onSubmit={onSubmit} className="flex flex-col gap-y-6">
          <div className="flex flex-col gap-y-4">
            <input
              className="rounded bg-background p-3 text-text outline outline-1 outline-secondary-dark hover:outline-primary"
              placeholder="Email or username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
            <input
              type="password"
              className="rounded bg-background p-3 text-text outline outline-1 outline-secondary-dark hover:outline-primary"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex w-full justify-center rounded bg-primary px-6 py-3 font-medium text-white shadow-lg disabled:bg-background"
          >
            {busy ? "Signing in…" : "Login"}
          </button>
          <p className="text-sm text-secondary-darker">
            Create new account?{" "}
            <Link className="text-primary" to="/register">
              Signup
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
