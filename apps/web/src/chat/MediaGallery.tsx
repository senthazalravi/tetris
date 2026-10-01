import { useMemo } from "react";
import { FileText, Film, Image as ImageIcon } from "lucide-react";
import { formatBytes, formatFull } from "@/lib/format";
import { mediaKind } from "@/lib/media";
import { useChat } from "@/state/chat";
import type { LocalMessage } from "@/state/localdb";
import { Modal } from "@/ui/kit";
import { AttachmentView } from "./Attachment";

function isMediaMessage(m: LocalMessage): boolean {
  if (m.deleted) return false;
  const c = m.content;
  return c.kind === "file" && Boolean(c.attachment) && !c.attachment?.voice;
}

export function MediaGallery({ convId, onClose }: { convId: string; onClose: () => void }) {
  const messages = useChat((s) => s.messages[convId]) ?? [];

  const items = useMemo(
    () =>
      [...messages]
        .filter(isMediaMessage)
        .sort((a, b) => b.createdAt - a.createdAt),
    [messages],
  );

  return (
    <Modal title="Media & files" onClose={onClose} wide>
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">No media or files in this chat yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((m) => {
            const c = m.content;
            if (c.kind !== "file" || !c.attachment) return null;
            const kind = mediaKind(c.attachment.mime, c.attachment.name);
            const Icon = kind === "image" ? ImageIcon : kind === "video" ? Film : FileText;
            return (
              <li
                key={m.id}
                className="overflow-hidden rounded-2xl border border-line bg-s2"
              >
                <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-muted">
                  <Icon size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">
                    {c.attachment.name || kind}
                  </span>
                  <span className="shrink-0 tabular">{formatBytes(c.attachment.size)}</span>
                </div>
                <div className="flex min-h-[5rem] items-center justify-center p-2">
                  <AttachmentView att={c.attachment} />
                </div>
                <div className="px-3 pb-2 text-[11px] text-faint">{formatFull(m.createdAt)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
