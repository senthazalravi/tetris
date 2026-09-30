import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { ensureDeviceReady, onWipeLocal, unlockVault } from "@/crypto/vaultCrypto";

export function UnlockPage() {
  const navigate = useNavigate();
  const {
    bootState,
    session,
    unlockState,
    unlockMode,
    unlockChallengeId,
    unlockExpiresAt,
    markUnlocked,
  } = useAuth();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const timedOutRef = useRef(false);
  const finishingRef = useRef(false);

  useEffect(() => {
    if (!unlockExpiresAt || unlockMode !== "hard") return;
    const tick = () => setRemainingMs(Math.max(0, unlockExpiresAt - Date.now()));
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [unlockExpiresAt, unlockMode]);

  if (bootState === "loading") {
    return (
      <div className="flex min-h-full items-center justify-center text-[var(--lop-muted)]">
        Loading…
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (unlockState === "unlocked") return <Navigate to="/app" replace />;
  if (unlockMode === "hard" && !unlockChallengeId) {
    return <Navigate to="/login" replace />;
  }

  async function finishHard(result: "SUCCESS" | "FAILURE") {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ wiped?: boolean }>("/auth/unlock", {
        unlockChallengeId,
        result,
      });
      if (res.wiped) {
        const { broadcastSessionEvent } = await import("@/hooks/sessionGuards");
        broadcastSessionEvent("wipe");
        await onWipeLocal();
      } else await ensureDeviceReady(passcode);
      markUnlocked();
      navigate("/app");
    } catch (err) {
      finishingRef.current = false;
      setError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ok = await unlockVault(passcode);
      if (!ok) {
        if (unlockMode === "soft") {
          setError("Wrong passcode. Try again.");
          setBusy(false);
          return;
        }
        await finishHard("FAILURE");
        return;
      }
      await ensureDeviceReady(passcode);
      if (unlockMode === "soft") {
        markUnlocked();
        navigate("/app");
        return;
      }
      await finishHard("SUCCESS");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (unlockMode !== "hard") return;
    if (
      remainingMs === 0 &&
      unlockExpiresAt &&
      Date.now() >= unlockExpiresAt &&
      !timedOutRef.current
    ) {
      timedOutRef.current = true;
      void finishHard("FAILURE");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs, unlockMode]);

  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl bg-[var(--lop-panel)] p-6 text-center shadow-xl"
      >
        <h1 className="text-xl font-semibold">Enter vault passcode</h1>
        <p className="mt-2 text-sm text-[var(--lop-muted)]">
          {unlockMode === "hard" ? (
            <>
              One attempt. {seconds}s remaining. Wrong or timeout clears chats
              and contacts — your account stays.
            </>
          ) : (
            <>Enter your vault passcode to unlock this device.</>
          )}
        </p>
        <input
          type="password"
          autoFocus
          className="mt-6 w-full rounded-lg border border-[var(--lop-border)] bg-[var(--lop-panel-2)] px-3 py-3 text-center text-lg tracking-widest outline-none focus:border-[var(--lop-accent)]"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          disabled={busy}
          required
        />
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || (unlockMode === "hard" && remainingMs <= 0)}
          className="mt-6 w-full rounded-lg bg-[var(--lop-accent)] px-4 py-3 font-medium text-[#111] disabled:opacity-60"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
