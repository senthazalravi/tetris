import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { FileText, Paperclip, SendHorizontal, Smile, X } from "lucide-react";
import { MAX_ATTACHMENT_BYTES } from "@lop/config";
import type { ConversationDto } from "@lop/types";
import { formatBytes } from "@/lib/format";
import { mediaKind } from "@/lib/media";
import { sendMessage, setReplyTo, stopTyping, toast, typingPing, useChat } from "@/state/chat";
import { useSession } from "@/state/session";
import { IconButton } from "@/ui/kit";
import { useOutside } from "@/ui/hooks";
import { EmojiPicker } from "./EmojiPicker";

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
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useOutside<HTMLDivElement>(emoji, useCallback(() => setEmoji(false), []));
  const fileInput = useRef<HTMLInputElement>(null);

  const preview = useMemo(
    () => (file && mediaKind(file.type) === "image" ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // A draft belongs to its conversation.
  useEffect(() => {
    setText("");
    setEmoji(false);
    area.current?.focus();
  }, [conv.id]);

  useEffect(() => {
    if (reply) area.current?.focus();
  }, [reply]);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const choose = useCallback(
    (f: File | null | undefined) => {
      if (!f) return;
      if (f.size > MAX_ATTACHMENT_BYTES) {
        toast(`Files can be up to ${formatBytes(MAX_ATTACHMENT_BYTES)}. That one is ${formatBytes(f.size)}.`);
        return;
      }
      if (f.size === 0) {
        toast("That file is empty.");
        return;
      }
      onFile(f);
      area.current?.focus();
    },
    [onFile],
  );

  const canSend = Boolean(text.trim() || file);

  function submit() {
    if (!canSend) return;
    void sendMessage(conv.id, { text, file, replyTo: reply });
    setText("");
    onFile(null);
    setEmoji(false);
    requestAnimationFrame(() => area.current?.focus());
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
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

  if (conv.blocked) {
    return (
      <div className="border-t border-line bg-s1 px-4 py-4 text-center text-sm text-muted">
        You blocked this contact. Unblock them from the contact info panel to send messages.
      </div>
    );
  }

  return (
    <div className="relative border-t border-line bg-s1 px-3 pb-3 pt-2 sm:px-4">
      {reply && (
        <div className="fade-in mb-2 flex items-start gap-3 rounded-xl border-l-[3px] border-pop bg-s2 px-3 py-2">
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="font-semibold text-pop">
              {reply.senderId === myId ? "Replying to yourself" : `Replying to ${conv.peer.displayName}`}
            </div>
            <div className="truncate text-muted">
              {reply.content.kind === "text"
                ? reply.content.body
                : reply.content.kind === "file"
                  ? reply.content.body || reply.content.attachment?.name || "Attachment"
                  : ""}
            </div>
          </div>
          <button onClick={() => setReplyTo(conv.id, null)} aria-label="Cancel reply" className="text-muted hover:text-fg">
            <X size={16} />
          </button>
        </div>
      )}

      {file && (
        <div className="fade-in mb-2 flex items-center gap-3 rounded-xl bg-s2 p-2.5">
          {preview ? (
            <img src={preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
          ) : (
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-s3 text-muted">
              <FileText size={22} />
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

      <div className="flex items-end gap-1.5">
        <div className="relative" ref={picker}>
          <IconButton label="Emoji" onClick={() => setEmoji((v) => !v)} className={emoji ? "bg-s3 text-fg" : ""}>
            <Smile size={21} />
          </IconButton>
          {emoji && (
            <div className="absolute bottom-full left-0 z-30 mb-2">
              <EmojiPicker onPick={insertEmoji} />
            </div>
          )}
        </div>
        <IconButton label="Attach a file" onClick={() => fileInput.current?.click()}>
          <Paperclip size={20} />
        </IconButton>
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <textarea
          ref={area}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) typingPing(conv.id);
            else stopTyping(conv.id);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => stopTyping(conv.id)}
          placeholder={file ? "Add a caption…" : "Write a message"}
          aria-label="Message"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-s2 px-4 py-2.5 text-[15px] leading-snug outline-none transition placeholder:text-faint focus:border-pop focus:ring-4 focus:ring-pop/15"
        />

        <button
          onClick={submit}
          disabled={!canSend}
          aria-label="Send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-onaccent shadow-[0_8px_24px_-10px_var(--pop)] transition hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:shadow-none"
        >
          <SendHorizontal size={19} />
        </button>
      </div>
    </div>
  );
}
