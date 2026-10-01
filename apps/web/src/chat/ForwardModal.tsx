import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import type { LocalMessage } from "@/state/localdb";
import { forwardMessage, nameOf, toast, useChat } from "@/state/chat";
import { Avatar, Button, Modal } from "@/ui/kit";

export function ForwardModal({
  message,
  onClose,
}: {
  message: LocalMessage;
  onClose: () => void;
}) {
  const conversations = useChat((s) => s.conversations);
  const nicknames = useChat((s) => s.nicknames);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return conversations
      .filter((c) => !c.blocked)
      .filter(
        (c) =>
          !term ||
          c.peer.displayName.toLowerCase().includes(term) ||
          c.peer.username.toLowerCase().includes(term) ||
          (nicknames[c.peer.userId] ?? "").toLowerCase().includes(term),
      )
      .sort((a, b) => nameOf(nicknames, a.peer).localeCompare(nameOf(nicknames, b.peer)));
  }, [conversations, nicknames, q]);

  const selected = rows.find((c) => c.id === selectedId) ?? null;

  async function send() {
    if (!selectedId || busy) return;
    setBusy(true);
    try {
      await forwardMessage(selectedId, message);
      toast("Message forwarded");
      onClose();
    } catch {
      toast("Couldn't forward that");
      setBusy(false);
    }
  }

  return (
    <Modal title="Forward to…" onClose={onClose}>
      <div className="relative mb-3">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          autoFocus
          className="h-10 w-full rounded-xl bg-s2 pl-10 pr-3 text-sm outline-none transition placeholder:text-faint focus:ring-2 focus:ring-pop/40"
        />
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No chats to forward to.</p>
      ) : (
        <ul className="-mx-2 max-h-[45vh] overflow-y-auto" role="listbox" aria-label="Choose a chat">
          {rows.map((c) => {
            const active = c.id === selectedId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={busy}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition disabled:opacity-60 ${
                    active ? "bg-s3 ring-1 ring-pop/50" : "hover:bg-s2"
                  }`}
                >
                  <Avatar name={c.peer.displayName} seed={c.peer.userId} url={c.peer.avatarUrl} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{nameOf(nicknames, c.peer)}</span>
                    <span className="block truncate text-xs text-muted">@{c.peer.username}</span>
                  </span>
                  {active && <Check size={18} className="shrink-0 text-pop" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="min-w-0 truncate text-sm text-muted">
          {selected ? `To ${nameOf(nicknames, selected.peer)}` : "Select a chat"}
        </p>
        <Button onClick={() => void send()} busy={busy} disabled={!selectedId || busy}>
          Send
        </Button>
      </div>
    </Modal>
  );
}
