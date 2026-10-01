import { useEffect, useState } from "react";
import { useSession } from "@/state/session";
import { TetrisMark } from "@/ui/kit";
import type { LegalPageId } from "@/ui/SiteFooter";
import { Login } from "@/screens/Login";
import { Legal } from "@/screens/Legal";
import { Replaced, Reset } from "@/screens/Reset";
import { ChatApp } from "@/chat/ChatApp";

/** Legal pages are the only routes; everything else is the app itself. */
function pathToLegal(pathname: string): LegalPageId | null {
  const id = pathname.replace(/^\//, "");
  return id === "privacy" || id === "terms" || id === "security" ? id : null;
}

export function App() {
  const phase = useSession((s) => s.phase);
  const boot = useSession((s) => s.boot);
  const [legal, setLegal] = useState<LegalPageId | null>(() =>
    pathToLegal(window.location.pathname),
  );

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    const onPop = () => setLegal(pathToLegal(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function goLegal(next: LegalPageId | null) {
    const path = next ? `/${next}` : "/";
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setLegal(next);
  }

  if (legal) {
    return <Legal page={legal} onHome={() => goLegal(null)} onOpenLegal={(id) => goLegal(id)} />;
  }

  switch (phase) {
    case "boot":
      return (
        <div className="flex h-full items-center justify-center bg-bg">
          <TetrisMark size={44} className="spin text-fg" />
        </div>
      );
    case "anon":
    case "locked":
      return <Login onOpenLegal={goLegal} />;
    case "reset":
      return <Reset />;
    case "replaced":
      return <Replaced />;
    case "ready":
      return <ChatApp />;
  }
}
