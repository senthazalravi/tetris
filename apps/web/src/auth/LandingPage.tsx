import { Link } from "react-router-dom";
import { Lock, MessageCircle, Timer } from "lucide-react";

export function LandingPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[var(--lop-bg)] px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--lop-panel)] text-[var(--lop-accent)] shadow-lg ring-1 ring-[var(--lop-border)]">
          <MessageCircle size={32} />
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--lop-accent)]">
          Lop
        </h1>
        <p className="mt-3 text-[var(--lop-muted)]">
          Private messaging. Nothing stays forever.
        </p>

        <div className="mt-8 grid gap-3 text-left text-sm text-[var(--lop-muted)]">
          <Feature
            icon={<Lock size={16} />}
            title="End-to-end encrypted"
            body="Messages are sealed in your browser before they leave."
          />
          <Feature
            icon={<Timer size={16} />}
            title="24-hour lifetime"
            body="Every message and file disappears automatically."
          />
          <Feature
            icon={<MessageCircle size={16} />}
            title="Find by @username"
            body="Exact lookup, private contacts, and chats that expire."
          />
        </div>

        <div className="mt-10 flex flex-col gap-3">
          <Link
            to="/login"
            className="rounded-xl bg-[var(--lop-accent)] px-4 py-3 font-semibold text-[#0b141a] hover:bg-[var(--lop-accent-hover)]"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="rounded-xl border border-[var(--lop-border)] bg-[var(--lop-panel)] px-4 py-3 font-medium hover:bg-[var(--lop-panel-2)]"
          >
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-[var(--lop-border)] bg-[var(--lop-panel)] p-3">
      <div className="mt-0.5 text-[var(--lop-accent)]">{icon}</div>
      <div>
        <div className="font-medium text-[var(--lop-text)]">{title}</div>
        <div>{body}</div>
      </div>
    </div>
  );
}
