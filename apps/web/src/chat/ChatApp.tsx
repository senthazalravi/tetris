import { useEffect, useState } from "react";
import { markRead, selectConversation, startEngine, stopEngine, useChat } from "@/state/chat";
import { useSession } from "@/state/session";
import { Game } from "@/screens/Game";
import { Avatar } from "@/ui/kit";
import { ThemeButton } from "@/ui/ThemeButton";
import { Profile } from "./Modals";
import { SearchBar } from "./SearchBar";
import { Thread } from "./Thread";

/**
 * The unlocked app. The Tetris game fills the screen (profile on top, search
 * at the bottom). Picking someone slides the game into a 35% column on the
 * left and opens the chat in the other 65%. On phones the chat opens over it.
 * There is no inbox, no conversation list and no unread counters.
 */
export function ChatApp() {
  const screen = useSession((s) => s.screen);
  const setScreen = useSession((s) => s.setScreen);
  const gameDone = useSession((s) => s.gameDone);
  const user = useSession((s) => s.user);
  const toast = useChat((s) => s.toast);
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const [profile, setProfile] = useState(false);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const chatOpen = screen === "chat" && active !== null;

  // Keep syncing and decrypting even while only the game is on screen.
  useEffect(() => {
    void startEngine();
    return () => stopEngine();
  }, []);

  // Reading resumes when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      const id = useChat.getState().activeId;
      if (document.visibilityState === "visible" && id && useSession.getState().screen === "chat") {
        void markRead(id);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  // Shortcuts: Cmd/Ctrl+F searches inside the open chat; Esc closes the chat
  // when you are not typing. (Cmd/Ctrl+K opens people search, in SearchBar.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        if (useSession.getState().screen === "chat" && useChat.getState().activeId) {
          e.preventDefault();
          window.dispatchEvent(new Event("tetris:chat-search"));
        }
        return;
      }
      if (e.key !== "Escape" || useSession.getState().screen !== "chat") return;
      if (document.querySelector("[role=dialog]")) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      selectConversation(null);
      setScreen("game");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setScreen]);

  return (
    <div className="flex h-full bg-bg">
      {/* The game. Centered on its own; slides to a 30% left column when a chat opens. */}
      <section
        className={`${
          chatOpen
            ? "hidden md:flex md:w-[35%] md:min-w-[340px] md:shrink-0 md:border-r"
            : "flex flex-1"
        } relative h-full min-w-0 flex-col border-line`}
      >
        <div className="glow-lime pointer-events-none absolute inset-0" />

        <header className="relative flex items-center gap-2 px-4 pb-1 pt-3">
          {user && (
            <button
              onClick={() => setProfile(true)}
              aria-label="Your profile"
              className="group flex min-w-0 items-center gap-3 rounded-2xl p-1.5 text-left transition hover:bg-s2"
            >
              <Avatar name={user.displayName} seed={user.id} url={user.avatarUrl} size={40} />
              <span className="min-w-0">
                <span className="block truncate font-display text-[15px] font-bold leading-tight">
                  {user.displayName}
                </span>
                <span className="block truncate text-xs text-muted">@{user.username}</span>
              </span>
            </button>
          )}
          <span className="flex-1" />
          <ThemeButton />
        </header>
        <div className="relative mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
          <div className="min-h-0 flex-1 pt-2">
            <Game />
          </div>
          <div className="px-4 pb-4 pt-2">
            <SearchBar disabled={!gameDone} />
          </div>
        </div>
      </section>

      {/* The chat appears only once someone is picked. Full screen over the game on phones. */}
      {chatOpen && active && (
        <main className="fixed inset-0 z-40 flex min-w-0 flex-col bg-bg md:static md:z-auto md:flex-1">
          <Thread key={active.id} conv={active} />
        </main>
      )}

      {profile && <Profile onClose={() => setProfile(false)} />}
      {toast && (
        <div
          role="status"
          className="pop-in fixed bottom-24 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 rounded-full border border-line bg-s4 px-5 py-3 text-sm shadow-[var(--shadow)]"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
