import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SessionUser } from "@lop/types";

type UnlockState = "none" | "required" | "unlocked";

interface AuthContextValue {
  session: SessionUser | null;
  unlockState: UnlockState;
  unlockChallengeId: string | null;
  unlockExpiresAt: number | null;
  setSession: (user: SessionUser | null) => void;
  beginUnlock: (challengeId: string, expiresAt: number) => void;
  markUnlocked: () => void;
  clearAuth: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<SessionUser | null>(null);
  const [unlockState, setUnlockState] = useState<UnlockState>("none");
  const [unlockChallengeId, setUnlockChallengeId] = useState<string | null>(null);
  const [unlockExpiresAt, setUnlockExpiresAt] = useState<number | null>(null);

  const setSession = useCallback((user: SessionUser | null) => {
    setSessionState(user);
    if (!user) {
      setUnlockState("none");
      setUnlockChallengeId(null);
      setUnlockExpiresAt(null);
    }
  }, []);

  const beginUnlock = useCallback((challengeId: string, expiresAt: number) => {
    setUnlockChallengeId(challengeId);
    setUnlockExpiresAt(expiresAt);
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
    setUnlockChallengeId(null);
    setUnlockExpiresAt(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      unlockState,
      unlockChallengeId,
      unlockExpiresAt,
      setSession,
      beginUnlock,
      markUnlocked,
      clearAuth,
    }),
    [
      session,
      unlockState,
      unlockChallengeId,
      unlockExpiresAt,
      setSession,
      beginUnlock,
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
