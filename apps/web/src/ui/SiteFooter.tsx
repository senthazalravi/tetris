export type LegalPageId = "privacy" | "terms" | "security";

const DEVELOPER_URL = "https://www.manasdutta.com/";

export function SiteFooter({ onOpenLegal }: { onOpenLegal: (id: LegalPageId) => void }) {
  return (
    <footer className="relative border-t border-line px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center text-xs text-faint sm:flex-row sm:justify-between sm:text-left">
        <p>
          Developed by{" "}
          <a
            href={DEVELOPER_URL}
            target="_blank"
            rel="noreferrer"
            className="text-muted transition hover:text-fg"
          >
            Manas Dutta
          </a>
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" aria-label="Legal">
          <button type="button" className="transition hover:text-fg" onClick={() => onOpenLegal("privacy")}>
            Privacy
          </button>
          <button type="button" className="transition hover:text-fg" onClick={() => onOpenLegal("terms")}>
            Terms
          </button>
          <button type="button" className="transition hover:text-fg" onClick={() => onOpenLegal("security")}>
            Security
          </button>
        </nav>
      </div>
    </footer>
  );
}
