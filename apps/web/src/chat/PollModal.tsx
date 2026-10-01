import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { POLL_MAX_OPTIONS, POLL_OPTION_MAX, POLL_QUESTION_MAX } from "@tetris/protocol";
import { sendPoll } from "@/state/chat";
import { Button, Modal } from "@/ui/kit";

export function PollModal({ convId, onClose }: { convId: string; onClose: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multi, setMulti] = useState(false);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim().length > 0 && filled.length >= 2 && new Set(filled.map((o) => o.toLowerCase())).size === filled.length;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    void sendPoll(convId, { question, options: filled, multi });
    onClose();
  }

  function setOption(i: number, v: string) {
    setOptions((list) => {
      const next = list.map((o, idx) => (idx === i ? v : o));
      // Always keep one empty slot at the end, up to the limit.
      if (next[next.length - 1]!.trim() && next.length < POLL_MAX_OPTIONS) next.push("");
      return next;
    });
  }

  return (
    <Modal title="Create poll" onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-muted">Question</span>
          <input
            autoFocus
            value={question}
            maxLength={POLL_QUESTION_MAX}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question"
            className="h-12 w-full rounded-xl border border-line bg-s2 px-4 text-[15px] outline-none transition placeholder:text-faint focus:border-pop focus:ring-4 focus:ring-pop/15"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-muted">Options</span>
          <ul className="space-y-2">
            {options.map((o, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  value={o}
                  maxLength={POLL_OPTION_MAX}
                  onChange={(e) => setOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  aria-label={`Option ${i + 1}`}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-s2 px-4 text-[15px] outline-none transition placeholder:text-faint focus:border-pop focus:ring-4 focus:ring-pop/15"
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOptions((l) => l.filter((_, idx) => idx !== i))}
                    aria-label={`Remove option ${i + 1}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-s3 hover:text-fg"
                  >
                    <X size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {options.length < POLL_MAX_OPTIONS && !options.some((o) => !o.trim()) && (
            <button
              type="button"
              onClick={() => setOptions((l) => [...l, ""])}
              className="mt-2 flex items-center gap-1.5 text-sm font-medium text-pop hover:underline"
            >
              <Plus size={15} /> Add option
            </button>
          )}
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-s2 px-4 py-3">
          <span>
            <span className="block text-sm font-medium">Allow multiple answers</span>
            <span className="block text-xs text-muted">Voters can pick more than one option.</span>
          </span>
          <input
            type="checkbox"
            checked={multi}
            onChange={(e) => setMulti(e.target.checked)}
            className="h-5 w-5 accent-[var(--pop)]"
          />
        </label>

        <Button type="submit" block disabled={!valid}>
          Send poll
        </Button>
      </form>
    </Modal>
  );
}
