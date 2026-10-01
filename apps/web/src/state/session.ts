import { create } from "zustand";
import {
  deriveAuthProof,
  deriveVaultSecrets,
  generateSaltB64,
  importAesKey,
} from "@lop/crypto";
import type { ChallengeDto, SessionUser } from "@lop/types";
import { api, ApiError, setAuthLostHandler, setVaultToken } from "@/lib/api";
import { deleteDatabase, dbNameFor, readStoredEpoch } from "./localdb";
import { isUnlocked, lockMemory, openVault, vault } from "./vault";
import { stopEngine } from "./chat";

export type Phase = "boot" | "anon" | "locked" | "vault-setup" | "ready" | "replaced";

export interface ActiveChallenge {
  id: string;
  vaultSalt: string;
  /** performance.now() based, so wall-clock changes cannot extend the window. */
  deadline: number;
  attemptUsed: boolean;
}

export interface WipeNotice {
  reason: "WRONG_PASSCODE" | "TIMEOUT" | "REMOTE";
}

interface SessionState {
  phase: Phase;
  user: SessionUser | null;
  challenge: ActiveChallenge | null;
  notice: WipeNotice | null;
  freshDevice: boolean;

  boot(): Promise<void>;
  register(input: {
    email: string;
    username: string;
    displayName: string;
    password: string;
    passcode: string;
    turnstileToken?: string;
  }): Promise<void>;
  login(input: { login: string; password: string; turnstileToken?: string }): Promise<void>;
  resetAccountPassword(input: {
    email: string;
    username: string;
    passcode?: string;
    password: string;
    turnstileToken?: string;
  }): Promise<{ message: string }>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  changeVaultPasscode(input: { currentPasscode: string; newPasscode: string }): Promise<void>;
  deleteAccount(password: string): Promise<void>;
  unlock(passcode: string): Promise<{ ok: boolean }>;
  expire(): Promise<void>;
  setupVault(passcode: string): Promise<void>;
  logout(): Promise<void>;
  remoteWipe(): Promise<void>;
  markReplaced(): void;
  updateUser(user: SessionUser): void;
  dismissNotice(): void;
}

type AuthPayload = {
  user: SessionUser | null;
  challenge?: ChallengeDto;
  vaultSetupRequired?: boolean;
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
    new BroadcastChannel("lop-wipe").postMessage({ userId });
  } catch {
    /* BroadcastChannel unavailable */
  }
}

export const useSession = create<SessionState>((set, get) => ({
  phase: "boot",
  user: null,
  challenge: null,
  notice: null,
  freshDevice: false,

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
      if (res.vaultSetupRequired) {
        return set({ phase: "vault-setup", user: res.user, challenge: null });
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

  async register(input) {
    const authSalt = generateSaltB64();
    const vaultSalt = generateSaltB64();
    const [authProof, vault] = await Promise.all([
      deriveAuthProof(input.password, authSalt),
      deriveVaultSecrets(input.passcode, vaultSalt),
    ]);
    const res = await api.post<{ user: SessionUser; vaultToken: string }>(
      "/auth/register",
      {
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        authSalt,
        authProof,
        vaultSalt,
        vaultVerifier: vault.verifier,
        turnstileToken: input.turnstileToken,
      },
    );
    await deleteDatabase(dbNameFor(res.user.id));
    setVaultToken(res.vaultToken);
    await openVault({
      userId: res.user.id,
      epoch: res.user.communicationEpoch,
      vaultKeyRaw: vault.vaultKey,
    });
    set({ user: res.user, phase: "ready", freshDevice: true, notice: null });
  },

  async login(input) {
    const { authSalt } = await api.post<{ authSalt: string }>("/auth/prelogin", {
      login: input.login,
    });
    const authProof = await deriveAuthProof(input.password, authSalt);
    const res = await api.post<AuthPayload>("/auth/login", {
      login: input.login,
      authProof,
      turnstileToken: input.turnstileToken,
    });
    if (!res.user) throw new ApiError(500, "Unexpected response");
    await reconcileLocal(res.user);
    if (res.vaultSetupRequired) {
      return set({ phase: "vault-setup", user: res.user, challenge: null, notice: null });
    }
    set({
      phase: "locked",
      user: res.user,
      challenge: res.challenge ? toActive(res.challenge) : null,
      notice: null,
    });
  },

  async resetAccountPassword(input) {
    const pre = await api.post<{ vaultSalt: string; requiresVault: boolean }>(
      "/auth/password-reset/preflight",
      { email: input.email },
    );
    if (pre.requiresVault && !input.passcode?.trim()) {
      throw new ApiError(
        400,
        "This account still has an active vault. Enter your vault passcode (not the account password).",
      );
    }
    const authSalt = generateSaltB64();
    const authProof = await deriveAuthProof(input.password, authSalt);
    let vaultVerifier: string | undefined;
    if (pre.requiresVault) {
      vaultVerifier = (await deriveVaultSecrets(input.passcode!.trim(), pre.vaultSalt)).verifier;
    }
    return api.post<{ message: string }>("/auth/password-reset", {
      email: input.email,
      username: input.username,
      vaultVerifier: vaultVerifier ?? null,
      authSalt,
      authProof,
      turnstileToken: input.turnstileToken,
    });
  },

  async unlock(passcode) {
    const { challenge, user } = get();
    if (!challenge || !user) return { ok: false };
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
      vaultToken?: string;
      user?: SessionUser;
    }>("/auth/unlock", { challengeId: challenge.id, verifier: secrets.verifier });

    if (!res.unlocked || !res.vaultToken || !res.user) {
      await wipeLocalNow(user.id);
      set({
        phase: "vault-setup",
        challenge: null,
        notice: { reason: res.reason ?? "WRONG_PASSCODE" },
      });
      return { ok: false };
    }

    setVaultToken(res.vaultToken);
    const { freshDevice } = await openVault({
      userId: res.user.id,
      epoch: res.user.communicationEpoch,
      vaultKeyRaw: secrets.vaultKey,
    });
    set({ phase: "ready", user: res.user, challenge: null, freshDevice });
    return { ok: true };
  },

  /** The 30s window closed with no answer. */
  async expire() {
    const { challenge, user } = get();
    if (!challenge || !user || get().phase !== "locked") return;
    // Local data goes immediately; the server confirms (and the cron backs it up).
    await wipeLocalNow(user.id);
    set({ phase: "vault-setup", challenge: null, notice: { reason: "TIMEOUT" } });
    try {
      await api.post("/auth/unlock", { challengeId: challenge.id, verifier: null });
    } catch {
      // Already settled elsewhere, or offline: the sweeper finishes the job.
    }
  },

  async setupVault(passcode) {
    const user = get().user;
    if (!user) return;
    const vaultSalt = generateSaltB64();
    const secrets = await deriveVaultSecrets(passcode, vaultSalt);
    const res = await api.post<{ vaultToken: string; user: SessionUser }>("/auth/vault", {
      vaultSalt,
      vaultVerifier: secrets.verifier,
    });
    await deleteDatabase(dbNameFor(res.user.id));
    setVaultToken(res.vaultToken);
    await openVault({
      userId: res.user.id,
      epoch: res.user.communicationEpoch,
      vaultKeyRaw: secrets.vaultKey,
    });
    set({ phase: "ready", user: res.user, freshDevice: true });
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

  async changePassword(input) {
    const login = get().user?.email;
    if (!login) throw new Error("Not signed in");
    const { authSalt } = await api.post<{ authSalt: string }>("/auth/prelogin", { login });
    const oldAuthProof = await deriveAuthProof(input.currentPassword, authSalt);
    const newSalt = generateSaltB64();
    const authProof = await deriveAuthProof(input.newPassword, newSalt);
    await api.post("/auth/change-password", {
      oldAuthProof,
      authSalt: newSalt,
      authProof,
    });
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

  async deleteAccount(password) {
    const login = get().user?.email;
    const userId = get().user?.id;
    if (!login || !userId) throw new Error("Not signed in");
    const { authSalt } = await api.post<{ authSalt: string }>("/auth/prelogin", { login });
    const authProof = await deriveAuthProof(password, authSalt);
    stopEngine();
    await api.post("/auth/delete-account", { authProof });
    lockMemory();
    setVaultToken(null);
    await deleteDatabase(dbNameFor(userId));
    set({ phase: "anon", user: null, challenge: null, notice: null });
  },

  /** Another tab or the server wiped us: drop memory and local data. */
  async remoteWipe() {
    const user = get().user;
    await wipeLocalNow(user?.id);
    if (get().phase === "anon") return;
    set({ phase: "boot" });
    await get().boot();
    if (get().phase === "vault-setup") set({ notice: { reason: "REMOTE" } });
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
  const ch = new BroadcastChannel("lop-wipe");
  ch.onmessage = (ev: MessageEvent<{ userId?: string }>) => {
    const s = useSession.getState();
    if (s.user && ev.data?.userId === s.user.id && (isUnlocked() || s.phase === "ready")) {
      void s.remoteWipe();
    }
  };
} catch {
  /* unsupported */
}
