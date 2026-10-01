import { useEffect, useState } from "react";
import { useSession } from "@/state/session";
import { LoopMark } from "@/ui/kit";
import type { LegalPageId } from "@/ui/SiteFooter";
import { Auth, type AuthMode } from "@/screens/Auth";
import { Landing } from "@/screens/Landing";
import { Legal } from "@/screens/Legal";
import { Unlock } from "@/screens/Unlock";
import { Replaced, VaultSetup } from "@/screens/VaultSetup";
import { ChatApp } from "@/chat/ChatApp";

type AppView = "landing" | AuthMode | LegalPageId;

const PATH_VIEWS: Record<string, AppView> = {
  "/": "landing",
  "/login": "login",
  "/register": "register",
  "/forgot": "forgot",
  "/privacy": "privacy",
  "/terms": "terms",
  "/security": "security",
};

function pathToView(pathname: string): AppView {
  return PATH_VIEWS[pathname] ?? "landing";
}

function viewToPath(view: AppView): string {
  if (view === "landing") return "/";
  return `/${view}`;
}

export function App() {
  const phase = useSession((s) => s.phase);
  const boot = useSession((s) => s.boot);
  const [view, setView] = useState<AppView>(() => pathToView(window.location.pathname));

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    const onPop = () => setView(pathToView(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(next: AppView) {
    const path = viewToPath(next);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    setView(next);
  }

  if (view === "privacy" || view === "terms" || view === "security") {
    return (
      <Legal page={view} onHome={() => go("landing")} onOpenLegal={(id) => go(id)} />
    );
  }

  switch (phase) {
    case "boot":
      return (
        <div className="flex h-full items-center justify-center bg-bg">
          <LoopMark size={44} className="spin text-fg" />
        </div>
      );
    case "anon":
      if (view === "landing") {
        return (
          <Landing
            onLogin={() => go("login")}
            onRegister={() => go("register")}
            onOpenLegal={(id) => go(id)}
          />
        );
      }
      return <Auth mode={view} onMode={(m) => go(m)} onBack={() => go("landing")} />;
    case "locked":
      return <Unlock />;
    case "vault-setup":
      return <VaultSetup />;
    case "replaced":
      return <Replaced />;
    case "ready":
      return <ChatApp />;
  }
}
