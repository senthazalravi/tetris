import { useEffect, useState } from "react";
import { useSession } from "@/state/session";
import { LoopMark } from "@/ui/kit";
import { Auth } from "@/screens/Auth";
import { Landing } from "@/screens/Landing";
import { Unlock } from "@/screens/Unlock";
import { Replaced, VaultSetup } from "@/screens/VaultSetup";
import { ChatApp } from "@/chat/ChatApp";

export function App() {
  const phase = useSession((s) => s.phase);
  const boot = useSession((s) => s.boot);
  const [view, setView] = useState<"landing" | "login" | "register">("landing");

  useEffect(() => {
    void boot();
  }, [boot]);

  switch (phase) {
    case "boot":
      return (
        <div className="flex h-full items-center justify-center bg-bg">
          <LoopMark size={44} className="spin text-fg" />
        </div>
      );
    case "anon":
      return view === "landing" ? (
        <Landing onLogin={() => setView("login")} onRegister={() => setView("register")} />
      ) : (
        <Auth mode={view} onMode={setView} onBack={() => setView("landing")} />
      );
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
