import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { markRead, startEngine, stopEngine, useChat } from "@/state/chat";
import { LoopMark } from "@/ui/kit";
import { NewChat, Profile } from "./Modals";
import { Sidebar } from "./Sidebar";
import { Thread } from "./Thread";

const BASE_TITLE = "Lop";

export function ChatApp() {
  const { conversations, activeId, messages, toast } = useChat();
  const [modal, setModal] = useState<"new" | "profile" | null>(null);

  useEffect(() => {
    void startEngine();
    return () => stopEngine();
  }, []);

  const unread = Object.values(messages).reduce(
    (n, list) => n + list.filter((m) => m.unread).length,
    0,
  );
  useEffect(() => {
    document.title = unread ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [unread]);

  // Reading resumes when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      const id = useChat.getState().activeId;
      if (document.visibilityState === "visible" && id) {
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

  const active = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-full bg-bg">
      <div className={`${active ? "hidden md:flex" : "flex"} h-full w-full md:w-auto`}>
        <Sidebar onNew={() => setModal("new")} onProfile={() => setModal("profile")} />
      </div>

      <div className={`${active ? "flex" : "hidden md:flex"} h-full min-w-0 flex-1`}>
        {active ? <Thread key={active.id} conv={active} /> : <EmptyThread />}
      </div>

      {modal === "new" && <NewChat onClose={() => setModal(null)} />}
      {modal === "profile" && <Profile onClose={() => setModal(null)} />}

      {toast && (
        <div
          role="status"
          className="pop-in fixed bottom-6 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 rounded-full border border-line bg-s4 px-5 py-3 text-sm shadow-[var(--shadow)]"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function EmptyThread() {
  return (
    <div className="dotgrid relative flex h-full flex-1 flex-col items-center justify-center bg-bg px-8 text-center">
      <div className="glow-lime pointer-events-none absolute inset-0" />
      <div className="relative">
        <LoopMark size={64} className="mx-auto text-fg" />
        <h2 className="mt-5 font-display text-3xl font-extrabold tracking-tight">Pick a chat</h2>
        <p className="mx-auto mt-2 max-w-sm text-muted">
          Or start a new one. Messages are sealed on your device and gone in 24 hours.
        </p>
        <p className="mt-8 inline-flex items-center gap-2 text-xs text-faint">
          <Lock size={12} /> End-to-end encrypted
        </p>
      </div>
    </div>
  );
}
