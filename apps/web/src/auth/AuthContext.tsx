import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SessionUser } from "@lop/types";
import { api } from "@/api/client";

type UnlockState = "none" | "required" | "unlocked";
type BootState = "loading" | "ready";
/** hard = login wipe gate; soft = refresh vault unlock only */
type UnlockMode = "hard" | "soft";

interface AuthContextValue {
  bootState: BootState;
  session: SessionUser | null;
  unlockState: UnlockState;
  unlockMode: UnlockMode;
  unlockChallengeId: string | null;
  unlockExpiresAt: number | null;
  setSession: (user: SessionUser | null) => void;
  beginUnlock: (
    challengeId: string,
    expiresAt: number,
    mode?: UnlockMode,
  ) => void;
  beginSoftUnlock: () => void;
  markUnlocked: () => void;
  clearAuth: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [bootState, setBootState] = useState<BootState>("loading");
  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [unlockState, setUnlockState] = useState<UnlockState>("none");
  const [unlockMode, setUnlockMode] = useState<UnlockMode>("hard");
  const [unlockChallengeId, setUnlockChallengeId] = useState<string | null>(
    null,
  );
  const [unlockExpiresAt, setUnlockExpiresAt] = useState<number | null>(null);

  const setSession = useCallback((user: SessionUser | null) => {
    setSessionState(user);
    if (!user) {
      setUnlockState("none");
      setUnlockChallengeId(null);
      setUnlockExpiresAt(null);
    }
  }, []);

  const beginUnlock = useCallback(
    (challengeId: string, expiresAt: number, mode: UnlockMode = "hard") => {
      setUnlockChallengeId(challengeId);
      setUnlockExpiresAt(expiresAt);
      setUnlockMode(mode);
      setUnlockState("required");
    },
    [],
  );

  const beginSoftUnlock = useCallback(() => {
    setUnlockChallengeId(null);
    setUnlockExpiresAt(null);
    setUnlockMode("soft");
    setUnlockState("required");
  }, []);

  const markUnlocked = useCallback(() => {
    setUnlockState("unlocked");
    setUnlockChallengeId(null);
    setUnlockExpiresAt(null);
  }, []);

  const clearAuth = useCallback(() => {
    setSessionState(null);
    setUnlockState("none");
    setUnlockMode("hard");
    setUnlockChallengeId(null);
    setUnlockExpiresAt(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ user: SessionUser | null }>("/auth/session");
        if (cancelled) return;
        if (res.user) {
          setSessionState(res.user);
          // Cookie session survived refresh — stay logged in, require vault passcode only.
          setUnlockMode("soft");
          setUnlockState("required");
          setUnlockChallengeId(null);
          setUnlockExpiresAt(null);
        }
      } catch {
        /* no session */
      } finally {
        if (!cancelled) setBootState("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      bootState,
      session,
      unlockState,
      unlockMode,
      unlockChallengeId,
      unlockExpiresAt,
      setSession,
      beginUnlock,
      beginSoftUnlock,
      markUnlocked,
      clearAuth,
    }),
    [
      bootState,
      session,
      unlockState,
      unlockMode,
      unlockChallengeId,
      unlockExpiresAt,
      setSession,
      beginUnlock,
      beginSoftUnlock,
      markUnlocked,
      clearAuth,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
