import { useAuth } from "@/auth/AuthContext";
import { api } from "@/api/client";

export function ChatShell() {
  const { session, clearAuth } = useAuth();

  async function logout() {
    try {
      await api.post("/auth/logout", {});
    } catch {
      /* ignore */
    }
    clearAuth();
    window.location.href = "/";
  }

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex w-full max-w-sm flex-col border-r border-[var(--lop-border)] bg-[var(--lop-panel)] md:w-[30%]">
        <header className="flex items-center justify-between border-b border-[var(--lop-border)] px-4 py-3">
          <div>
            <div className="font-semibold text-[var(--lop-accent)]">Lop</div>
            <div className="text-xs text-[var(--lop-muted)]">
              @{session?.username}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm text-[var(--lop-muted)] hover:text-[var(--lop-text)]"
          >
            Log out
          </button>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-[var(--lop-muted)]">
          <p className="text-base text-[var(--lop-text)]">No conversations</p>
          <p className="text-sm">
            Search by exact @username to start a chat.
          </p>
        </div>
      </aside>
      <main className="hidden flex-1 items-center justify-center bg-[var(--lop-bg)] text-[var(--lop-muted)] md:flex">
        Select a chat or start a new one
      </main>
    </div>
  );
}
