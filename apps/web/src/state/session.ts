import { create } from "zustand";
import {
  deriveVaultSecrets,
  generateSaltB64,
  importAesKey,
} from "@tetris/crypto";
import type { ChallengeDto, SessionUser } from "@tetris/types";
import { api, ApiError, setAuthLostHandler, setVaultToken } from "@/lib/api";
import { deleteDatabase, dbNameFor, readStoredEpoch } from "./localdb";
import { isUnlocked, lockMemory, openVault, vault } from "./vault";
import { stopEngine } from "./chat";

export type Phase = "boot" | "anon" | "locked" | "reset" | "ready" | "replaced";

/** What the unlocked app is showing: the Tetris home screen or a chat. */
export type Screen = "game" | "chat";

export interface ActiveChallenge {
  id: string;
  vaultSalt: string;
  /** performance.now() based, so wall-clock changes cannot extend the window. */
  deadline: number;
  attemptUsed: boolean;
}

export interface WipeNotice {
  reason: "WRONG_PASSCODE" | "TIMEOUT" | "REMOTE" | "EXPIRED";
}

interface SessionState {
  phase: Phase;
  user: SessionUser | null;
  challenge: ActiveChallenge | null;
  notice: WipeNotice | null;
  freshDevice: boolean;

  /** Which screen the unlocked app shows. */
  screen: Screen;
  /** A Tetris round has ended this session, which unlocks the chat search. */
  gameDone: boolean;
  /** Username to prefill on the reset screen. */
  resetUsername: string;

  boot(): Promise<void>;
  /** Sign in: username + passcode. Opens the 30s challenge and answers it at once. */
  start(input: { username: string; passcode: string; turnstileToken?: string }): Promise<void>;
  /** Expired passcode: confirm the email on file, then choose a new one. */
  reset(input: {
    username: string;
    email: string;
    passcode: string;
    turnstileToken?: string;
  }): Promise<void>;
  openReset(username?: string): void;
  cancelReset(): void;
  markGameDone(): void;
  setScreen(screen: Screen): void;
  changeVaultPasscode(input: { currentPasscode: string; newPasscode: string }): Promise<void>;
  unlock(passcode: string): Promise<{ ok: boolean }>;
  expire(): Promise<void>;
  logout(): Promise<void>;
  remoteWipe(): Promise<void>;
  markReplaced(): void;
  updateUser(user: SessionUser): void;
  dismissNotice(): void;
}

type AuthPayload = {
  user: SessionUser | null;
  challenge?: ChallengeDto;
  expired?: boolean;
};

function toActive(c: ChallengeDto): ActiveChallenge {
  return {
    id: c.id,
    vaultSalt: c.vaultSalt,
    deadline: performance.now() + c.remainingMs + 150,
    attemptUsed: false,
  };
}

/** Wipe anything on this device that belongs to an epoch the server has left. */
async function reconcileLocal(user: SessionUser) {
  try {
    const stored = await readStoredEpoch(user.id);
    if (stored !== null && stored !== user.communicationEpoch) {
      await deleteDatabase(dbNameFor(user.id));
    }
  } catch {
    /* no database yet */
  }
}

async function wipeLocalNow(userId: string | undefined) {
  stopEngine();
  lockMemory();
  setVaultToken(null);
  if (userId) await deleteDatabase(dbNameFor(userId));
  try {
    new BroadcastChannel("tetris-wipe").postMessage({ userId });
  } catch {
    /* BroadcastChannel unavailable */
  }
}

/** After a wipe the passcode is expired: send the user to the email-confirmed reset. */
async function enterReset(notice: WipeNotice) {
  let username = useSession.getState().user?.username ?? useSession.getState().resetUsername;
  try {
    const res = await api.post<AuthPayload>("/auth/resume");
    if (res.user) username = res.user.username;
  } catch {
    /* keep whatever username we already know */
  }
  useSession.setState({ phase: "reset", resetUsername: username, challenge: null, notice });
}

export const useSession = create<SessionState>((set, get) => ({
  phase: "boot",
  user: null,
  challenge: null,
  notice: null,
  freshDevice: false,
  screen: "game",
  gameDone: false,
  resetUsername: "",

  async boot() {
    setAuthLostHandler((code) => {
      if (get().phase !== "ready") return;
      // Lost the session or vault token: everything in memory must go.
      void (async () => {
        stopEngine();
        lockMemory();
        setVaultToken(null);
        if (code === "NO_SESSION") set({ phase: "anon", user: null, challenge: null });
        else await get().boot();
      })();
    });

    try {
      const res = await api.post<AuthPayload>("/auth/resume");
      if (!res.user) return set({ phase: "anon", user: null });
      await reconcileLocal(res.user);
      if (res.expired) {
        return set({
          phase: "reset",
          user: res.user,
          resetUsername: res.user.username,
          challenge: null,
          notice: { reason: "EXPIRED" },
        });
      }
      set({
        phase: "locked",
        user: res.user,
        challenge: res.challenge ? toActive(res.challenge) : null,
      });
    } catch {
      set({ phase: "anon", user: null });
    }
  },

  async start(input) {
    const res = await api.post<AuthPayload>("/auth/start", {
      username: input.username,
      turnstileToken: input.turnstileToken,
    });
    if (res.expired) {
      return set({
        phase: "reset",
        user: null,
        resetUsername: input.username,
        challenge: null,
        notice: { reason: "EXPIRED" },
      });
    }
    if (!res.challenge) throw new ApiError(500, "Unexpected response");
    set({
      challenge: toActive(res.challenge),
      user: null,
      resetUsername: input.username,
      notice: null,
    });
    await get().unlock(input.passcode);
  },

  openReset(username) {
    set({ phase: "reset", resetUsername: username ?? get().resetUsername, challenge: null });
  },

  cancelReset() {
    set({ phase: "anon", user: null, challenge: null, notice: null });
  },

  markGameDone() {
    set({ gameDone: true });
  },

  setScreen(screen) {
    set({ screen });
  },

  async unlock(passcode) {
    const { challenge, user } = get();
    if (!challenge) return { ok: false };
    try {
      // Claim the attempt on the server clock before the slow key derivation.
      await api.post("/auth/unlock/begin", { challengeId: challenge.id });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        set({ challenge: { ...challenge, attemptUsed: true } });
        throw new ApiError(
          409,
          "That attempt was already used. Your chats will be cleared when the timer ends.",
        );
      }
      throw e;
    }
    set({ challenge: { ...challenge, attemptUsed: true } });

    const secrets = await deriveVaultSecrets(passcode, challenge.vaultSalt);
    const res = await api.post<{
      unlocked: boolean;
      wiped: boolean;
      reason?: "WRONG_PASSCODE" | "TIMEOUT";
      userId?: string;
      vaultToken?: string;
      user?: SessionUser;
    }>("/auth/unlock", { challengeId: challenge.id, verifier: secrets.verifier });

    if (!res.unlocked || !res.vaultToken || !res.user) {
      if (!res.wiped) {
        // Not this account's own browser (or no such account): nothing was wiped.
        set({ phase: "anon", user: null, challenge: null });
        throw new ApiError(401, "Incorrect username or passcode");
      }
      await wipeLocalNow(res.userId ?? user?.id);
      await enterReset({ reason: res.reason ?? "WRONG_PASSCODE" });
      return { ok: false };
    }

    setVaultToken(res.vaultToken);
    const { freshDevice } = await openVault({
      userId: res.user.id,
      epoch: res.user.communicationEpoch,
      vaultKeyRaw: secrets.vaultKey,
    });
    set({
      phase: "ready",
      screen: "game",
      gameDone: false,
      user: res.user,
      challenge: null,
      freshDevice,
    });
    return { ok: true };
  },

  /** The 30s window closed with no answer. */
  async expire() {
    const { challenge, user } = get();
    if (!challenge || !user || get().phase !== "locked") return;
    // Local data goes immediately; the server confirms (and the cron backs it up).
    let wiped = true;
    try {
      const res = await api.post<{ wiped?: boolean }>("/auth/unlock", {
        challengeId: challenge.id,
        verifier: null,
      });
      wiped = res.wiped !== false;
    } catch {
      // Already settled elsewhere, or offline: the sweeper finishes the job.
    }
    if (!wiped) {
      // Not this account's own browser: the server did not wipe, so neither do we.
      set({ phase: "anon", user: null, challenge: null });
      return;
    }
    await wipeLocalNow(user.id);
    await enterReset({ reason: "TIMEOUT" });
  },

  async reset(input) {
    const vaultSalt = generateSaltB64();
    const secrets = await deriveVaultSecrets(input.passcode, vaultSalt);
    const res = await api.post<{ vaultToken: string; user: SessionUser }>("/auth/reset", {
      username: input.username,
      email: input.email,
      vaultSalt,
      vaultVerifier: secrets.verifier,
      turnstileToken: input.turnstileToken,
    });
    await deleteDatabase(dbNameFor(res.user.id));
    setVaultToken(res.vaultToken);
    await openVault({
      userId: res.user.id,
      epoch: res.user.communicationEpoch,
      vaultKeyRaw: secrets.vaultKey,
    });
    set({
      phase: "ready",
      screen: "game",
      gameDone: false,
      user: res.user,
      freshDevice: true,
      notice: null,
    });
  },

  async logout() {
    stopEngine();
    lockMemory();
    try {
      await api.post("/auth/logout");
    } catch {
      /* cookie expires regardless */
    }
    setVaultToken(null);
    set({ phase: "anon", user: null, challenge: null, notice: null });
  },

  async changeVaultPasscode(input) {
    const user = get().user;
    if (!user || !isUnlocked()) throw new Error("Vault is locked");
    const { vaultSalt } = await api.get<{ vaultSalt: string }>("/auth/vault-salt");
    const oldSecrets = await deriveVaultSecrets(input.currentPasscode, vaultSalt);
    const newSalt = generateSaltB64();
    const newSecrets = await deriveVaultSecrets(input.newPasscode, newSalt);
    await api.post("/auth/change-vault", {
      oldVerifier: oldSecrets.verifier,
      vaultSalt: newSalt,
      vaultVerifier: newSecrets.verifier,
    });
    const newKey = await importAesKey(newSecrets.vaultKey, false);
    newSecrets.vaultKey.fill(0);
    await vault().db.rekey(newKey);
  },

  /** Another tab or the server wiped us: drop memory and local data. */
  async remoteWipe() {
    const user = get().user;
    await wipeLocalNow(user?.id);
    if (get().phase === "anon") return;
    set({ phase: "boot" });
    await get().boot();
    if (get().phase === "reset") set({ notice: { reason: "REMOTE" } });
  },

  /** Another browser signed in and took over this account's single device. */
  markReplaced() {
    if (get().phase !== "ready") return;
    stopEngine();
    lockMemory();
    setVaultToken(null);
    set({ phase: "replaced" });
  },
  updateUser(user) {
    set({ user });
  },
  dismissNotice() {
    set({ notice: null });
  },
}));

// Same-browser tabs: a wipe in one tab clears the others immediately.
try {
  const ch = new BroadcastChannel("tetris-wipe");
  ch.onmessage = (ev: MessageEvent<{ userId?: string }>) => {
    const s = useSession.getState();
    if (s.user && ev.data?.userId === s.user.id && (isUnlocked() || s.phase === "ready")) {
      void s.remoteWipe();
    }
  };
} catch {
  /* unsupported */
}
