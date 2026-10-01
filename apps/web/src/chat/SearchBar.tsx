import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { openChatWith, toast } from "@/state/chat";
import { useSession } from "@/state/session";
import { Avatar } from "@/ui/kit";

interface Match {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** "⌘K" on macOS, "Ctrl K" on Windows and Linux. */
export const SEARCH_SHORTCUT_LABEL = isMac ? "⌘K" : "Ctrl K";

/**
 * The only way to reach a chat: type part of a username, pick someone. It
 * stays on screen while chatting, so picking another person just switches.
 * Cmd+K (macOS) or Ctrl+K (Windows/Linux) jumps straight into it.
 */
export function SearchBar({ disabled = false }: { disabled?: boolean }) {
  const setScreen = useSession((s) => s.setScreen);
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      if (disabledRef.current) {
        toast("Finish a round of Tetris to unlock search");
        return;
      }
      input.current?.focus();
      input.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim().replace(/^@/, "");
    if (disabled || !term) {
      seq.current++;
      setMatches([]);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ users: Match[] }>(`/users/search?q=${encodeURIComponent(term)}`);
        if (mine !== seq.current) return;
        setMatches(res.users);
        setActive(0);
      } catch (e) {
        if (mine !== seq.current) return;
        setMatches([]);
        if (e instanceof ApiError && e.status === 429) toast(e.message);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q, disabled]);

  async function pick(m: Match) {
    try {
      await openChatWith(m.userId);
      setQ("");
      setMatches([]);
      setOpen(false);
      input.current?.blur();
      setScreen("chat");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start that chat");
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[active];
      if (m) void pick(m);
    } else if (e.key === "Escape") {
      setQ("");
      setOpen(false);
      input.current?.blur();
    }
  }

  const showList = open && !disabled && q.trim().length > 0;

  return (
    <div className="relative w-full">
      {showList && (
        <ul
          role="listbox"
          className="pop-in absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-line bg-s1 p-1.5 shadow-[var(--shadow)]"
        >
          {matches.length === 0 && !searching && (
            <li className="px-3 py-3 text-sm text-muted">No one matches &ldquo;{q.trim()}&rdquo;.</li>
          )}
          {matches.map((m, i) => (
            <li key={m.userId} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pick(m)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                  i === active ? "bg-s3" : "hover:bg-s2"
                }`}
              >
                <Avatar name={m.displayName} seed={m.userId} url={m.avatarUrl} size={36} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{m.displayName}</span>
                  <span className="block truncate text-xs text-muted">@{m.username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <label
        className={`flex h-12 items-center gap-3 rounded-full border px-4 shadow-[var(--shadow)] transition ${
          disabled
            ? "border-line bg-s2/70 text-faint"
            : "border-line bg-s1 text-fg focus-within:border-pop focus-within:ring-4 focus-within:ring-pop/15"
        }`}
      >
        {disabled ? <Lock size={17} /> : <Search size={17} className="text-muted" />}
        <input
          ref={input}
          value={q}
          disabled={disabled}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
          placeholder={disabled ? "Finish a round to unlock search" : "Search people"}
          aria-label="Search people"
          aria-keyshortcuts="Control+K Meta+K"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          style={{ outline: "none" }}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-faint disabled:cursor-not-allowed"
        />
        {searching && <Loader2 size={16} className="animate-spin text-muted" />}
        {!disabled && !searching && (
          <kbd className="shrink-0 rounded-md bg-s3 px-1.5 py-0.5 text-[11px] font-medium text-muted">
            {SEARCH_SHORTCUT_LABEL}
          </kbd>
        )}
      </label>
    </div>
  );
}
