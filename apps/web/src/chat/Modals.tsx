import { useEffect, useRef, useState, type FormEvent } from "react";
import { Ban, Camera, Lock, LogOut, Monitor, Moon, Search, ShieldCheck, Sun, Trash2, UserMinus } from "lucide-react";
import { DISPLAY_NAME_MAX } from "@lop/config";
import type { ConversationDto } from "@lop/types";
import { api, ApiError } from "@/lib/api";
import { makeAvatar } from "@/lib/media";
import {
  getSafetyNumber,
  openChatWith,
  removeContact,
  selectConversation,
  setBlocked,
  toast,
  useChat,
} from "@/state/chat";
import { useSession } from "@/state/session";
import { useTheme, type ThemeChoice } from "@/state/theme";
import { Avatar, Button, Field, Modal } from "@/ui/kit";

/* ------------------------------------------------------------------ */
/* new chat                                                            */
/* ------------------------------------------------------------------ */

interface Found {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isSelf: boolean;
}

export function NewChat({ onClose }: { onClose: () => void }) {
  const contacts = useChat((s) => s.contacts);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(userId: string) {
    setBusy(true);
    try {
      await openChatWith(userId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start that chat");
      setBusy(false);
    }
  }

  async function lookup(e: FormEvent) {
    e.preventDefault();
    const username = q.trim().replace(/^@/, "");
    if (!username) return;
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      setFound(await api.get<Found>(`/users/lookup?username=${encodeURIComponent(username)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New chat" onClose={onClose}>
      <form onSubmit={lookup} className="flex items-end gap-2">
        <Field
          label="Their exact @username"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="@friend"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          className="flex-1"
        />
        <Button type="submit" busy={busy} className="h-12" aria-label="Find">
          <Search size={17} /> Find
        </Button>
      </form>
      <p className="mt-2 text-xs text-faint">
        There is no directory and no search. People are only found by their full username.
      </p>

      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      {found && (
        <div className="pop-in mt-4 flex items-center gap-3 rounded-2xl border border-lines bg-s2 p-3">
          <Avatar name={found.displayName} seed={found.userId} url={found.avatarUrl} size={46} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{found.displayName}</div>
            <div className="text-sm text-muted">@{found.username}</div>
          </div>
          {found.isSelf ? (
            <span className="text-xs text-muted">That's you</span>
          ) : (
            <Button size="sm" onClick={() => void open(found.userId)} busy={busy}>
              Message
            </Button>
          )}
        </div>
      )}

      {contacts.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-faint">Your contacts</h3>
          <ul className="-mx-2">
            {contacts.map((c) => (
              <li key={c.userId}>
                <button
                  onClick={() => void open(c.userId)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-s2"
                >
                  <Avatar name={c.displayName} seed={c.userId} url={c.avatarUrl} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.displayName}</span>
                    <span className="block truncate text-xs text-muted">@{c.username}</span>
                  </span>
                  {c.blocked && <Ban size={14} className="text-danger" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* contact info                                                        */
/* ------------------------------------------------------------------ */

export function ContactInfo({ conv, onClose }: { conv: ConversationDto; onClose: () => void }) {
  const [safety, setSafety] = useState<string | null | undefined>(undefined);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const peer = conv.peer;

  useEffect(() => {
    let live = true;
    getSafetyNumber(conv)
      .then((s) => live && setSafety(s))
      .catch(() => live && setSafety(null));
    return () => {
      live = false;
    };
  }, [conv]);

  const groups = safety ? (safety.replace(/\s+/g, "").match(/.{1,5}/g) ?? []) : [];

  async function block() {
    setBusy(true);
    try {
      await setBlocked(peer.userId, !conv.blocked);
      toast(conv.blocked ? `Unblocked ${peer.displayName}` : `Blocked ${peer.displayName}`);
    } catch {
      toast("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeContact(peer.userId);
      selectConversation(null);
      onClose();
    } catch {
      toast("Couldn't remove the contact");
      setBusy(false);
    }
  }

  return (
    <Modal title="Contact info" onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <Avatar name={peer.displayName} seed={peer.userId} url={peer.avatarUrl} size={88} />
        <h3 className="mt-3 font-display text-2xl font-bold">{peer.displayName}</h3>
        <p className="text-muted">@{peer.username}</p>
      </div>

      <div className="mt-6 rounded-2xl bg-s2 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck size={16} className="text-pop" /> Safety number
        </div>
        {safety === undefined ? (
          <p className="text-sm text-muted">Calculating…</p>
        ) : safety ? (
          <>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1.5 font-mono text-[15px] tabular">
              {groups.map((g, i) => (
                <span key={i}>{g}</span>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Compare this with {peer.displayName} in person or on a call. If it matches on both
              screens, nobody is sitting in the middle of your chat.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            Available once {peer.displayName} has set up their vault on a device.
          </p>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <Button variant="soft" block onClick={() => void block()} busy={busy}>
          <Ban size={16} /> {conv.blocked ? "Unblock" : "Block"} {peer.displayName}
        </Button>
        {confirmRemove ? (
          <div className="pop-in rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm">
            <p className="mb-3 text-muted">
              Remove this contact? You'll stop seeing this chat. They can still message you unless blocked.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" size="sm" onClick={() => void remove()} busy={busy}>
                <UserMinus size={15} /> Remove
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" block onClick={() => setConfirmRemove(true)}>
            <Trash2 size={16} /> Remove contact
          </Button>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* profile                                                             */
/* ------------------------------------------------------------------ */

const THEMES: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "light", label: "Light", icon: Sun },
];

export function Profile({ onClose }: { onClose: () => void }) {
  const { user, updateUser, logout } = useSession();
  const { choice, setChoice } = useTheme();
  const [name, setName] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!user) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!user || !name.trim() || name.trim() === user.displayName) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch<{ user: typeof user }>("/users/me", { displayName: name.trim() });
      updateUser(res.user);
      toast("Profile updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function photo(f: File | undefined) {
    if (!f || !user) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const bytes = await makeAvatar(f);
      const res = await api.putBinary<{ avatarUrl: string }>("/users/me/avatar", bytes);
      updateUser({ ...user, avatarUrl: res.avatarUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't use that image");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    if (!user) return;
    setPhotoBusy(true);
    try {
      await api.del("/users/me/avatar");
      updateUser({ ...user, avatarUrl: null });
    } catch {
      setError("Couldn't remove the photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <Modal title="Your profile" onClose={onClose}>
      <div className="flex flex-col items-center">
        <div className="relative">
          <Avatar name={user.displayName} seed={user.id} url={user.avatarUrl} size={96} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy}
            aria-label="Change photo"
            className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-onaccent shadow-lg transition hover:brightness-110 disabled:opacity-60"
          >
            <Camera size={17} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              void photo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {user.avatarUrl && (
          <button onClick={() => void removePhoto()} className="mt-2 text-xs text-muted underline hover:text-fg">
            Remove photo
          </button>
        )}
        <p className="mt-3 text-muted">@{user.username}</p>
        <p className="text-xs text-faint">{user.email}</p>
      </div>

      <form onSubmit={save} className="mt-5 flex items-end gap-2">
        <Field
          label="Display name"
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" busy={saving} disabled={!name.trim() || name.trim() === user.displayName} className="h-12">
          Save
        </Button>
      </form>
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      <div className="mt-6">
        <div className="mb-2 text-[13px] font-medium text-muted">Appearance</div>
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-s2 p-1">
          {THEMES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setChoice(id)}
              className={`flex h-10 items-center justify-center gap-2 rounded-xl text-sm transition ${
                choice === id ? "bg-s4 font-medium text-fg shadow" : "text-muted hover:text-fg"
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button variant="soft" onClick={() => location.reload()}>
          <Lock size={16} /> Lock now
        </Button>
        <Button variant="danger" onClick={() => void logout()}>
          <LogOut size={16} /> Sign out
        </Button>
      </div>
      <p className="mt-3 text-center text-xs leading-relaxed text-faint">
        Locking reloads Lop, so you'll be asked for your passcode again (one attempt, 30 seconds).
      </p>
    </Modal>
  );
}
