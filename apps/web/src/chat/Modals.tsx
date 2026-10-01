import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AtSign,
  Ban,
  Camera,
  Check,
  CheckCheck,
  Clock,
  Eraser,
  Keyboard,
  KeyRound,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Search,
  Shuffle,
  ShieldCheck,
  Sun,
  Timer,
  Trash2,
  UserMinus,
  Send,
} from "lucide-react";
import { DISPLAY_NAME_MAX, PASSCODE_PATTERN } from "@tetris/config";
import type { ConversationDto } from "@tetris/types";
import { api, ApiError } from "@/lib/api";
import { formatFull, formatRemaining } from "@/lib/format";
import { makeAvatar, svgToPng } from "@/lib/media";
import {
  clearChat,
  getSafetyNumber,
  nameOf,
  openChatWith,
  removeContact,
  selectConversation,
  setNickname,
  toast,
  useChat,
} from "@/state/chat";
import type { LocalMessage } from "@/state/localdb";
import { useSession } from "@/state/session";
import { useTheme, type ThemeChoice } from "@/state/theme";
import {
  Avatar,
  Button,
  Field,
  Modal,
  PasscodeField,
  SQUIGGLE_PRESETS,
  squiggleUrl,
} from "@/ui/kit";

/* ------------------------------------------------------------------ */
/* new chat                                                            */
/* ------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
        {title}
      </h3>
      <div className="overflow-hidden rounded-2xl border border-line bg-s2">{children}</div>
    </section>
  );
}

function Row({
  icon: Icon,
  label,
  hint,
  onClick,
  danger,
  busy,
}: {
  icon: typeof Ban;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition last:border-b-0 hover:bg-s3 disabled:opacity-60 ${
        danger ? "text-danger" : ""
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && <span className="block text-xs font-normal text-muted">{hint}</span>}
      </span>
    </button>
  );
}

export function ChatPrivacyLearnModal({
  onClose,
  group = false,
}: {
  onClose: () => void;
  group?: boolean;
}) {
  return (
    <Modal title="How this chat stays private" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex gap-3 rounded-2xl border border-line bg-s2 p-4">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-pop" aria-hidden />
          <div className="min-w-0 text-sm leading-relaxed">
            <p className="font-semibold">End-to-end encryption</p>
            <p className="mt-1.5 text-muted">
              Text, photos, voice notes, and files are encrypted in your browser before they leave
              your device. Only you and the person you're chatting with can read them—the service
              stores ciphertext, not the plain content.
            </p>
          </div>
        </div>
        <div className="flex gap-3 rounded-2xl border border-line bg-s2 p-4">
          <Timer size={20} className="mt-0.5 shrink-0 text-pop" aria-hidden />
          <div className="min-w-0 text-sm leading-relaxed">
            <p className="font-semibold">Messages that vanish</p>
            <p className="mt-1.5 text-muted">
              Every message and attachment expires about {group ? "7 days" : "24 hours"} after it is
              sent, based on the server clock—not when it was read. After that, copies on the server
              are removed. Either of you can still screenshot or save something before it expires.
            </p>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-faint">
          Encryption protects message content, not all metadata (for example who you talk to and
          when). Open contact info from the header to compare your safety number with this person.
        </p>
      </div>
      <div className="mt-5 flex justify-end">
        <Button onClick={onClose}>Got it</Button>
      </div>
    </Modal>
  );
}

/** Group details: who is in it, and how the group is protected. */
export function GroupInfo({ conv, onClose }: { conv: ConversationDto; onClose: () => void }) {
  const myId = useSession((st) => st.user?.id);
  const members = conv.group?.members ?? [];
  return (
    <Modal title={conv.group?.name ?? "Group"} onClose={onClose}>
      <p className="flex items-center gap-2 text-xs text-muted">
        <Timer size={13} /> Group messages and files vanish 7 days after they&apos;re sent.
      </p>
      <p className="mt-1 text-xs text-muted">
        Every message is end-to-end encrypted separately for each member.
      </p>
      <Section title={`${members.length} members`}>
        <ul className="space-y-1">
          {members.map((u) => (
            <li key={u.userId} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
              <Avatar name={u.displayName} seed={u.userId} url={u.avatarUrl} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {u.displayName}
                  {u.userId === myId ? " (you)" : ""}
                </span>
                <span className="block truncate text-xs text-muted">@{u.username}</span>
              </span>
              {!u.deviceId && (
                <span className="shrink-0 text-[11px] text-faint">hasn&apos;t signed in yet</span>
              )}
            </li>
          ))}
        </ul>
      </Section>
    </Modal>
  );
}

export function ContactInfo({ conv, onClose }: { conv: ConversationDto; onClose: () => void }) {
  const nicknames = useChat((s) => s.nicknames);
  const peer = conv.peer;
  const nickname = nicknames[peer.userId] ?? "";
  const [draft, setDraft] = useState(nickname);
  const [safety, setSafety] = useState<string | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<"clear" | "remove" | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function saveNickname(e: FormEvent) {
    e.preventDefault();
    await setNickname(peer.userId, draft);
    toast(draft.trim() ? "Nickname saved" : "Nickname removed");
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
      <div className="relative -mx-5 -mt-5 mb-1 overflow-hidden px-5 pb-6 pt-8 text-center">
        <div className="relative flex flex-col items-center">
          <div className="rounded-full p-1 ring-2 ring-pop/60">
            <Avatar name={peer.displayName} seed={peer.userId} url={peer.avatarUrl} size={96} />
          </div>
          <h3 className="mt-3 font-display text-3xl leading-tight">{nameOf(nicknames, peer)}</h3>
          <p className="mt-0.5 flex items-center gap-1 text-muted">
            <AtSign size={14} />
            {peer.username}
          </p>
          {nickname && (
            <p className="mt-1 text-xs text-faint">
              Profile name: <span className="text-muted">{peer.displayName}</span>
            </p>
          )}
        </div>
      </div>

      <Section title="Nickname">
        <form onSubmit={saveNickname} className="flex items-center gap-2 p-3">
          <div className="relative flex-1">
            <Pencil
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={40}
              placeholder={peer.displayName}
              aria-label="Nickname"
              className="h-11 w-full rounded-xl border border-line bg-s1 pl-10 pr-3 text-[15px] outline-none transition placeholder:text-faint focus:border-pop focus:ring-4 focus:ring-pop/15"
            />
          </div>
          <Button type="submit" disabled={draft.trim() === nickname}>
            Save
          </Button>
        </form>
        <p className="px-4 pb-3 text-xs text-faint">
          Only you see this. It's stored on this device and shown everywhere instead of their
          profile name.
        </p>
      </Section>

      <Section title="Encryption">
        <div className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck size={16} className="text-pop" /> Safety number
          </div>
          {safety === undefined ? (
            <p className="text-sm text-muted">Calculating…</p>
          ) : safety ? (
            <>
              <div className="grid grid-cols-4 gap-x-3 gap-y-2 rounded-xl bg-s1 p-3 font-mono text-[14px] tabular sm:text-[15px]">
                {groups.map((g, i) => (
                  <span key={i}>{g}</span>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Compare this with {nameOf(nicknames, peer)} in person or on a call. If it matches on
                both screens, nobody is sitting in the middle of your chat.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              Available once {nameOf(nicknames, peer)} has set up their vault on a device.
            </p>
          )}
          <p className="mt-3 flex items-center gap-2 text-xs text-faint">
            <Timer size={13} /> Messages vanish 24 hours after they're sent.
          </p>
        </div>
      </Section>

      <Section title="Manage">
        {confirm === "clear" ? (
          <ConfirmRow
            text="Remove every message in this chat from this device? Your contact keeps their own copy until it expires."
            action="Clear chat"
            onCancel={() => setConfirm(null)}
            onConfirm={async () => {
              await clearChat(conv.id);
              toast("Chat cleared");
              setConfirm(null);
            }}
          />
        ) : (
          <Row
            icon={Eraser}
            label="Clear chat"
            hint="Delete all messages here, on this device"
            onClick={() => setConfirm("clear")}
          />
        )}
        {confirm === "remove" ? (
          <ConfirmRow
            text="Remove this contact? You'll stop seeing this chat. They can still message you."
            action="Remove"
            onCancel={() => setConfirm(null)}
            onConfirm={remove}
          />
        ) : (
          <Row
            icon={UserMinus}
            label="Remove contact"
            danger
            onClick={() => setConfirm("remove")}
          />
        )}
      </Section>
    </Modal>
  );
}

function ConfirmRow({
  text,
  action,
  onConfirm,
  onCancel,
}: {
  text: string;
  action: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="pop-in border-b border-line bg-danger/10 p-4 last:border-b-0">
      <p className="mb-3 text-sm text-muted">{text}</p>
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="sm"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
          }}
        >
          {action}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* message info                                                        */
/* ------------------------------------------------------------------ */

function InfoRow({
  icon,
  label,
  value,
  dim,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-s3">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className={`text-xs ${dim ? "text-faint" : "text-muted"}`}>{value}</div>
      </div>
    </div>
  );
}

export function MessageInfo({ m, onClose }: { m: LocalMessage; onClose: () => void }) {
  const out = m.direction === "out";
  const c = m.content;
  const preview =
    c.kind === "text"
      ? c.body
      : c.kind === "file"
        ? c.body || (c.attachment?.voice ? "Voice message" : c.attachment?.name) || "Attachment"
        : c.kind === "poll"
          ? `Poll: ${c.poll?.question ?? ""}`
          : "";
  const left = m.expiresAt - Date.now();

  return (
    <Modal title="Message info" onClose={onClose}>
      {preview && (
        <div className="mb-4 flex justify-end">
          <div className={`bubble ${out ? "out" : "in"} line-clamp-4 !max-w-full`}>{preview}</div>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-line bg-s2">
        {out ? (
          <>
            <InfoRow
              icon={<Send size={15} />}
              label="Sent"
              value={
                m.state === "failed"
                  ? "Not sent"
                  : m.state === "sending"
                    ? "Sending…"
                    : formatFull(m.createdAt)
              }
              dim={m.state === "failed" || m.state === "sending"}
            />
            <InfoRow
              icon={<CheckCheck size={16} />}
              label="Delivered"
              value={
                m.deliveredAt
                  ? formatFull(m.deliveredAt)
                  : m.state === "delivered" || m.state === "read"
                    ? "Yes"
                    : "Not yet"
              }
              dim={!m.deliveredAt && m.state !== "delivered" && m.state !== "read"}
            />
            <InfoRow
              icon={<CheckCheck size={16} className="text-[#2aa8e6]" strokeWidth={2.8} />}
              label="Read"
              value={m.readAt ? formatFull(m.readAt) : m.state === "read" ? "Yes" : "Not yet"}
              dim={!m.readAt && m.state !== "read"}
            />
          </>
        ) : (
          <InfoRow icon={<Check size={16} />} label="Received" value={formatFull(m.createdAt)} />
        )}
        <InfoRow
          icon={<Clock size={15} />}
          label="Vanishes"
          value={`${formatFull(m.expiresAt)} · in ${formatRemaining(left)}`}
        />
      </div>
      <p className="mt-3 text-center text-xs text-faint">
        Times come from the server clock. Every copy disappears{" "}
        {m.expiresAt - m.createdAt > 3 * 86_400_000 ? "7 days" : "24 hours"} after sending.
      </p>
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

function randomSeed() {
  return `sq-${crypto.randomUUID().slice(0, 8)}`;
}

export function Profile({ onClose }: { onClose: () => void }) {
  const { user, updateUser, logout, changeVaultPasscode } = useSession();
  const { choice, setChoice } = useTheme();
  const [name, setName] = useState(user?.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [curPass, setCurPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [passBusy, setPassBusy] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  if (!user) return null;

  const shown = seed ? squiggleUrl(seed) : user.avatarUrl || squiggleUrl(user.id);

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

  async function upload(bytesPromise: Promise<Uint8Array>, keepSeed: string | null = null) {
    if (!user) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const bytes = await bytesPromise;
      const res = await api.putBinary<{ avatarUrl: string }>("/users/me/avatar", bytes);
      updateUser({ ...user, avatarUrl: res.avatarUrl });
      setSeed(keepSeed);
      toast("Avatar updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't use that image");
    } finally {
      setPhotoBusy(false);
    }
  }

  function pickSquiggle(next: string) {
    if (photoBusy) return;
    setSeed(next);
    void upload(svgToPng(squiggleUrl(next)), next);
  }

  async function onChangePasscode(e: FormEvent) {
    e.preventDefault();
    setPassError(null);
    if (!PASSCODE_PATTERN.test(curPass) || !PASSCODE_PATTERN.test(newPass)) {
      return setPassError("Passcodes are exactly 8 digits.");
    }
    if (newPass !== confirmPass) return setPassError("New passcodes don't match.");
    setPassBusy(true);
    try {
      await changeVaultPasscode({ currentPasscode: curPass, newPasscode: newPass });
      setCurPass("");
      setNewPass("");
      setConfirmPass("");
      toast("Passcode updated");
    } catch (err) {
      setPassError(err instanceof Error ? err.message : "Couldn't change passcode");
    } finally {
      setPassBusy(false);
    }
  }

  const modKey =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

  return (
    <Modal title="Your profile" onClose={onClose}>
      <div className="flex flex-col items-center">
        <div className="relative">
          <div className="rounded-full p-1 ring-2 ring-pop/60">
            <img
              src={shown}
              alt="Your avatar"
              className="h-24 w-24 rounded-full bg-s3 object-cover"
            />
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy}
            aria-label="Upload your own photo"
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
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(makeAvatar(f));
            }}
          />
        </div>
        <p className="mt-3 text-muted">@{user.username}</p>
      </div>

      <div className="mt-5 rounded-2xl border border-line bg-s2 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[13px] font-medium text-muted">Pick an avatar</span>
          <button
            onClick={() => pickSquiggle(randomSeed())}
            disabled={photoBusy}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-fg transition hover:bg-s3 disabled:opacity-60"
            aria-label="Shuffle a new avatar"
          >
            <Shuffle size={13} /> Shuffle
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {SQUIGGLE_PRESETS.map((s) => (
            <button
              key={s}
              onClick={() => pickSquiggle(s)}
              disabled={photoBusy}
              aria-label={`Avatar ${s}`}
              aria-pressed={seed === s}
              className={`overflow-hidden rounded-full transition hover:scale-105 disabled:opacity-60 ${
                seed === s ? "ring-2 ring-pop ring-offset-2 ring-offset-s2" : ""
              }`}
            >
              <img
                src={squiggleUrl(s)}
                alt=""
                className="aspect-square w-full bg-s3"
                draggable={false}
              />
            </button>
          ))}
        </div>
        <div className="mt-3">
          <Button
            size="sm"
            variant="soft"
            onClick={() => fileRef.current?.click()}
            disabled={photoBusy}
          >
            Upload a photo
          </Button>
        </div>
      </div>

      <form onSubmit={save} className="mt-5 flex items-end gap-2">
        <Field
          label="Display name"
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Button
          type="submit"
          busy={saving}
          disabled={!name.trim() || name.trim() === user.displayName}
          className="h-12"
        >
          Save
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

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

      <form onSubmit={onChangePasscode} className="mt-6 space-y-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
          <Lock size={15} /> Change passcode
        </div>
        <PasscodeField label="Current passcode" value={curPass} onValue={setCurPass} />
        <PasscodeField label="New passcode" value={newPass} onValue={setNewPass} />
        <PasscodeField label="Confirm new passcode" value={confirmPass} onValue={setConfirmPass} />
        {passError && (
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
            {passError}
          </p>
        )}
        <Button
          type="submit"
          busy={passBusy}
          disabled={!curPass || !newPass || !confirmPass}
          variant="soft"
          block
        >
          Update passcode
        </Button>
      </form>

      <div className="mt-6 rounded-2xl border border-line bg-s2 p-4">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-muted">
          <Keyboard size={15} /> Keyboard shortcuts
        </div>
        <ul className="space-y-1.5 text-sm text-muted">
          <li>
            <kbd className="rounded bg-s3 px-1.5 py-0.5 text-xs text-fg">{modKey}+K</kbd> Search
            people
          </li>
          <li>
            <kbd className="rounded bg-s3 px-1.5 py-0.5 text-xs text-fg">{modKey}+F</kbd> Search in
            chat
          </li>
          <li>
            <kbd className="rounded bg-s3 px-1.5 py-0.5 text-xs text-fg">Esc</kbd> Close dialogs and
            chat
          </li>
        </ul>
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
        Locking reloads Tetris, so you'll be asked for your passcode again (one attempt, 30
        seconds).
      </p>
    </Modal>
  );
}
