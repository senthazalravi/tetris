import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import {
  BarChart3,
  Camera,
  Check,
  FileText,
  Headphones,
  Image as ImageIcon,
  Mic,
  Music,
  Paperclip,
  Pencil,
  SendHorizontal,
  Smile,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ConversationDto } from "@tetris/types";
import { formatBytes } from "@/lib/format";
import { attachmentProblem, mediaKind, mimeOf } from "@/lib/media";
import {
  nameOf,
  sendEdit,
  sendMessage,
  setDraft,
  setEditing,
  setReplyTo,
  stopTyping,
  toast,
  typingPing,
  useChat,
} from "@/state/chat";
import { useSession } from "@/state/session";
import { Avatar, IconButton } from "@/ui/kit";
import { useOutside } from "@/ui/hooks";
import { CameraModal } from "./CameraModal";
import { EmojiPicker } from "./EmojiPicker";
import { PollModal } from "./PollModal";
import { useRecorder } from "./useRecorder";

type PickerKind = "document" | "media" | "audio";

const ACCEPT: Record<PickerKind, string | undefined> = {
  document: undefined, // anything WhatsApp Web accepts, and more
  media: "image/*,video/*",
  audio: "audio/*",
};

interface MenuItem {
  id: "document" | "media" | "camera" | "audio" | "poll";
  label: string;
  hint: string;
  icon: LucideIcon;
  color: string;
}

const MENU: MenuItem[] = [
  {
    id: "document",
    label: "Document",
    hint: "PDF, Word, Excel, ZIP, any file",
    icon: FileText,
    color: "#7f66ff",
  },
  {
    id: "media",
    label: "Photos & videos",
    hint: "Videos up to 16 MB",
    icon: ImageIcon,
    color: "#0a8cff",
  },
  { id: "camera", label: "Camera", hint: "Take a photo now", icon: Camera, color: "#ff2e74" },
  { id: "audio", label: "Audio", hint: "Music and recordings", icon: Headphones, color: "#ff8a1c" },
  { id: "poll", label: "Poll", hint: "Ask the chat a question", icon: BarChart3, color: "#f5a800" },
];

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Composer({
  conv,
  file,
  onFile,
}: {
  conv: ConversationDto;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const myId = useSession((s) => s.user?.id);
  const reply = useChat((s) => s.replyTo[conv.id] ?? null);
  const peerName = nameOf(
    useChat((s) => s.nicknames),
    conv.peer,
  );
  const editing = useChat((s) => s.editing[conv.id] ?? null);
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [menu, setMenu] = useState(false);
  const [poll, setPoll] = useState(false);
  const [camera, setCamera] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const picker = useOutside<HTMLDivElement>(
    emoji,
    useCallback(() => setEmoji(false), []),
  );
  const attachMenu = useOutside<HTMLDivElement>(
    menu,
    useCallback(() => setMenu(false), []),
  );
  const inputs = {
    document: useRef<HTMLInputElement>(null),
    media: useRef<HTMLInputElement>(null),
    audio: useRef<HTMLInputElement>(null),
  };

  const kind = file ? mediaKind(mimeOf(file), file.name) : null;
  const preview = useMemo(
    () => (file && (kind === "image" || kind === "video") ? URL.createObjectURL(file) : null),
    [file, kind],
  );
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const recorder = useRecorder((voice, durationMs) => {
    void sendMessage(conv.id, { text: "", file: voice, voiceMs: durationMs, replyTo: reply });
  });

  // A draft belongs to its conversation — restore on switch, flush on leave.
  useEffect(() => {
    setText(useChat.getState().drafts[conv.id] ?? "");
    setEmoji(false);
    setMenu(false);
    area.current?.focus();
    const id = conv.id;
    return () => {
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
      }
      if (!editingRef.current) void setDraft(id, textRef.current);
    };
  }, [conv.id]);

  // Debounce-persist draft while typing (skip while editing).
  useEffect(() => {
    if (editing) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void setDraft(conv.id, text);
    }, 300);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [text, conv.id, editing]);

  useEffect(() => {
    if (reply) area.current?.focus();
  }, [reply]);

  // Start editing: load the message text into the box and drop any staged file.
  const editingId = editing?.id;
  useEffect(() => {
    if (!editing) return;
    onFile(null);
    setText(
      editing.content.kind === "text" || editing.content.kind === "file"
        ? editing.content.body
        : "",
    );
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, conv.id]);

  function cancelEdit() {
    setEditing(conv.id, null);
    setText("");
  }

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const choose = useCallback(
    (f: File | null | undefined) => {
      if (!f) return;
      const problem = attachmentProblem(f, formatBytes);
      if (problem) {
        toast(problem);
        return;
      }
      onFile(f);
      area.current?.focus();
    },
    [onFile],
  );

  const canSend = editing ? Boolean(text.trim()) : Boolean(text.trim() || file);

  function submit() {
    if (!canSend) return;
    if (editing) {
      void sendEdit(conv.id, editing.id, text);
      setText("");
      requestAnimationFrame(() => area.current?.focus());
      return;
    }
    void sendMessage(conv.id, { text, file, replyTo: reply });
    setText("");
    void setDraft(conv.id, "");
    onFile(null);
    setEmoji(false);
    requestAnimationFrame(() => area.current?.focus());
  }

  // @mentions (groups only): the "@word" being typed right before the caret.
  const mention = (() => {
    if (!conv.group) return null;
    const before = text.slice(0, caret);
    const m = /(^|\s)@([a-z0-9_]*)$/i.exec(before);
    if (!m) return null;
    const start = before.length - m[2]!.length - 1;
    if (mentionDismissed === start) return null;
    return { start, query: m[2]!.toLowerCase() };
  })();
  const mentionMatches = mention
    ? (conv.group?.members ?? [])
        .filter(
          (u) =>
            u.userId !== myId &&
            (u.username.toLowerCase().includes(mention.query) ||
              u.displayName.toLowerCase().includes(mention.query)),
        )
        .sort(
          (a, b) =>
            Number(b.username.toLowerCase().startsWith(mention.query)) -
            Number(a.username.toLowerCase().startsWith(mention.query)),
        )
        .slice(0, 6)
    : [];
  const mentionOpen = mention !== null && mentionMatches.length > 0;

  function pickMention(username: string) {
    if (!mention) return;
    const el = area.current;
    const end = caret;
    const next = `${text.slice(0, mention.start)}@${username} ${text.slice(end)}`;
    const pos = mention.start + username.length + 2;
    setText(next);
    setCaret(pos);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen && !e.nativeEvent.isComposing) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIdx((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIdx((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const u = mentionMatches[Math.min(mentionIdx, mentionMatches.length - 1)];
        if (u) pickMention(u.username);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionDismissed(mention!.start);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && editing) {
      cancelEdit();
    } else if (e.key === "Escape" && reply) {
      setReplyTo(conv.id, null);
    }
  }

  function onPaste(e: ClipboardEvent) {
    const f = Array.from(e.clipboardData.files)[0];
    if (f) {
      e.preventDefault();
      choose(f);
    }
  }

  function insertEmoji(em: string) {
    const el = area.current;
    if (!el) return setText((t) => t + em);
    const s = el.selectionStart ?? text.length;
    const eEnd = el.selectionEnd ?? s;
    const next = text.slice(0, s) + em + text.slice(eEnd);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + em.length, s + em.length);
    });
  }

  function pick(id: MenuItem["id"]) {
    setMenu(false);
    if (id === "document" || id === "media" || id === "audio") inputs[id].current?.click();
    else if (id === "camera") setCamera(true);
    else if (id === "poll") setPoll(true);
  }

  const replyText =
    reply?.content.kind === "text"
      ? reply.content.body
      : reply?.content.kind === "file"
        ? reply.content.body ||
          (reply.content.attachment?.voice ? "Voice message" : reply.content.attachment?.name) ||
          "Attachment"
        : reply?.content.kind === "poll"
          ? `Poll: ${reply.content.poll?.question ?? ""}`
          : "";

  return (
    <div className="relative border-t border-line bg-bg px-3 pb-3 pt-2 sm:px-4">
      {reply && (
        <div className="fade-in mb-2 flex items-start gap-3 rounded-xl border-l-[3px] border-pop bg-s2 px-3 py-2">
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="font-semibold text-pop">
              {reply.senderId === myId ? "Replying to yourself" : `Replying to ${peerName}`}
            </div>
            <div className="truncate text-muted">{replyText}</div>
          </div>
          <button
            onClick={() => setReplyTo(conv.id, null)}
            aria-label="Cancel reply"
            className="text-muted hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {editing && (
        <div className="fade-in mb-2 flex items-start gap-3 rounded-xl border-l-[3px] border-pop bg-s2 px-3 py-2">
          <Pencil size={15} className="mt-0.5 shrink-0 text-pop" />
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="font-semibold text-pop">Editing message</div>
            <div className="truncate text-muted">
              {editing.content.kind === "text" || editing.content.kind === "file"
                ? editing.content.body
                : ""}
            </div>
          </div>
          <button
            onClick={cancelEdit}
            aria-label="Cancel edit"
            className="text-muted hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {file && (
        <div className="fade-in mb-2 flex items-center gap-3 rounded-xl bg-s2 p-2.5">
          {preview && kind === "image" ? (
            <img src={preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
          ) : preview && kind === "video" ? (
            <video
              src={preview}
              muted
              playsInline
              preload="metadata"
              className="h-14 w-14 rounded-lg bg-black object-cover"
            />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-s3 text-muted">
              {kind === "audio" ? <Music size={22} /> : <FileText size={22} />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{file.name || "Pasted file"}</div>
            <div className="text-xs text-muted">
              {formatBytes(file.size)} · encrypted before upload
            </div>
          </div>
          <IconButton label="Remove attachment" onClick={() => onFile(null)}>
            <X size={17} />
          </IconButton>
        </div>
      )}

      {recorder.recording ? (
        <div
          className="flex items-center gap-2"
          role="group"
          aria-label="Recording a voice message"
        >
          <IconButton label="Discard recording" onClick={recorder.cancel} className="!text-danger">
            <Trash2 size={20} />
          </IconButton>
          <div className="flex h-11 flex-1 items-center gap-3 rounded-2xl border border-line bg-s2 px-4">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-danger" />
            </span>
            <span className="tabular text-[15px] font-medium" aria-live="off">
              {clock(recorder.elapsed)}
            </span>
            <span className="truncate text-sm text-muted">
              Recording... encrypted when you send
            </span>
          </div>
          <button
            onClick={recorder.send}
            aria-label="Send voice message"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-onaccent shadow-[0_8px_24px_-10px_var(--pop)] transition hover:brightness-110 active:scale-95"
          >
            <SendHorizontal size={19} />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <div className="relative" ref={picker}>
            <IconButton
              label="Emoji"
              onClick={() => setEmoji((v) => !v)}
              className={emoji ? "bg-s3 text-fg" : ""}
            >
              <Smile size={21} />
            </IconButton>
            {emoji && (
              <div className="absolute bottom-full left-0 z-30 mb-2">
                <EmojiPicker onPick={insertEmoji} />
              </div>
            )}
          </div>

          <div className="relative" ref={attachMenu}>
            <IconButton
              label="Attach"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => {
                setMenu((v) => !v);
                setEmoji(false);
              }}
              className={menu ? "bg-s3 text-fg" : ""}
            >
              <Paperclip size={20} className={`transition-transform ${menu ? "rotate-45" : ""}`} />
            </IconButton>
            {menu && (
              <div
                role="menu"
                aria-label="Attach"
                className="pop-in absolute bottom-full left-0 z-30 mb-2 w-72 rounded-2xl border border-line bg-s1 p-1.5 shadow-[var(--shadow)]"
              >
                {MENU.map(({ id, label, hint, icon: Icon, color }) => (
                  <button
                    key={id}
                    role="menuitem"
                    onClick={() => pick(id)}
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-s3"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
                      style={{ background: color }}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium leading-tight">{label}</span>
                      <span className="block truncate text-xs text-muted">{hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {(Object.keys(inputs) as PickerKind[]).map((k) => (
            <input
              key={k}
              ref={inputs[k]}
              type="file"
              hidden
              accept={ACCEPT[k]}
              aria-label={`${k} file`}
              onChange={(e) => {
                choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          ))}

          <div className="relative min-w-0 flex-1">
            {mentionOpen && (
              <ul
                role="listbox"
                aria-label="Mention a member"
                className="panel pop-in absolute bottom-full left-0 z-30 mb-2 w-72 max-w-full overflow-hidden rounded-2xl p-1.5 shadow-[var(--shadow)]"
              >
                {mentionMatches.map((u, idx) => (
                  <li key={u.userId} role="option" aria-selected={idx === mentionIdx}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickMention(u.username)}
                      onMouseEnter={() => setMentionIdx(idx)}
                      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition ${
                        idx === mentionIdx ? "bg-s3" : "hover:bg-s2"
                      }`}
                    >
                      <Avatar name={u.displayName} seed={u.userId} url={u.avatarUrl} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{u.displayName}</span>
                        <span className="block truncate text-xs text-muted">@{u.username}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              ref={area}
              value={text}
              rows={1}
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setMentionIdx(0);
                if (e.target.value) typingPing(conv.id);
                else stopTyping(conv.id);
              }}
              onKeyDown={onKeyDown}
              onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onPaste={onPaste}
              onBlur={() => stopTyping(conv.id)}
              placeholder={file ? "Add a caption…" : "Write a message"}
              aria-label="Message"
              className="max-h-40 min-h-11 w-full resize-none rounded-3xl border border-line bg-s2 px-4 py-2.5 text-[15px] leading-snug outline-none transition placeholder:text-faint focus:border-pop focus:ring-4 focus:ring-pop/15"
            />
          </div>

          {canSend || editing ? (
            <button
              onClick={submit}
              disabled={!canSend}
              aria-label={editing ? "Save edit" : "Send"}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-onaccent shadow-[0_8px_24px_-10px_var(--pop)] transition hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:shadow-none"
            >
              {editing ? <Check size={20} strokeWidth={2.6} /> : <SendHorizontal size={19} />}
            </button>
          ) : (
            <button
              onClick={() => void recorder.start()}
              disabled={recorder.starting}
              aria-label="Record a voice message"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-onaccent shadow-[0_8px_24px_-10px_var(--pop)] transition hover:brightness-110 active:scale-95 disabled:opacity-60"
            >
              <Mic size={19} />
            </button>
          )}
        </div>
      )}

      {poll && <PollModal convId={conv.id} onClose={() => setPoll(false)} />}
      {camera && <CameraModal onCapture={choose} onClose={() => setCamera(false)} />}
    </div>
  );
}
