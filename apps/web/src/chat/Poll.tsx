import { BarChart3, Check } from "lucide-react";
import type { PollRef } from "@lop/protocol";
import type { LocalMessage } from "@/state/localdb";
import { sendVote } from "@/state/chat";

/** A poll bubble. Each vote is its own end-to-end encrypted message. */
export function PollCard({ m, poll, myId }: { m: LocalMessage; poll: PollRef; myId: string }) {
  const votes = m.votes ?? {};
  const mine = votes[myId] ?? [];
  const counts = poll.options.map(() => 0);
  for (const picks of Object.values(votes)) for (const i of picks) if (i < counts.length) counts[i]!++;
  const voters = Object.keys(votes).length;
  const sending = m.state === "sending" || m.state === "failed";

  function toggle(i: number) {
    if (sending) return;
    const next = poll.multi
      ? mine.includes(i)
        ? mine.filter((n) => n !== i)
        : [...mine, i]
      : mine.includes(i)
        ? []
        : [i];
    void sendVote(m.convId, m.id, next);
  }

  return (
    <div className="w-64 max-w-full min-w-[15rem] py-0.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-75">
        <BarChart3 size={13} /> Poll
      </div>
      <div className="mb-1 break-words text-[15px] font-semibold leading-snug">{poll.question}</div>
      <div className="mb-2.5 text-xs opacity-75">
        {poll.multi ? "Select one or more" : "Select one"}
      </div>
      <ul className="space-y-1.5">
        {poll.options.map((opt, i) => {
          const picked = mine.includes(i);
          const pct = voters ? Math.round((counts[i]! / voters) * 100) : 0;
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-pressed={picked}
                disabled={sending}
                className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg bg-black/15 px-2.5 py-2 text-left transition hover:bg-black/25 disabled:opacity-70"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
                <span
                  className={`relative flex h-[18px] w-[18px] shrink-0 items-center justify-center border-2 ${
                    poll.multi ? "rounded-md" : "rounded-full"
                  } ${picked ? "border-current bg-current" : "border-current/60"}`}
                >
                  {picked && (
                    <Check size={12} strokeWidth={3.5} className={m.direction === "out" ? "text-[#0b6b53]" : "text-bg"} />
                  )}
                </span>
                <span className="relative min-w-0 flex-1 break-words text-sm">{opt}</span>
                <span className="relative shrink-0 text-xs font-semibold tabular">{counts[i]}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 text-[11px] opacity-75">
        {voters === 0 ? "No votes yet" : `${voters} ${voters === 1 ? "vote" : "votes"}`}
      </div>
    </div>
  );
}
