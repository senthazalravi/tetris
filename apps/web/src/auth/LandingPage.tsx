import { Link } from "react-router-dom";
import { Lock, MessageCircle, Timer } from "lucide-react";

export function LandingPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-4 text-text">
      <div className="w-full max-w-lg">
        <div className="flex flex-col gap-y-2">
          <h1 className="font-brand text-6xl font-bold max-sm:text-5xl">Lop</h1>
          <h2 className="text-2xl font-semibold">
            Discover your next conversation
          </h2>
          <p className="text-lg text-secondary-darker">
            Private, end-to-end encrypted messaging. Every message disappears
            after 24 hours.
          </p>
        </div>

        <div className="mt-8 grid gap-3">
          <Feature
            icon={<Lock size={16} />}
            title="End-to-end encrypted"
            body="Sealed in your browser before anything leaves the device."
          />
          <Feature
            icon={<Timer size={16} />}
            title="24-hour lifetime"
            body="Messages and files expire automatically."
          />
          <Feature
            icon={<MessageCircle size={16} />}
            title="Find by @username"
            body="Exact lookup, private contacts, messaging only."
          />
        </div>

        <div className="mt-10 flex flex-col gap-3">
          <Link
            to="/login"
            className="rounded bg-primary px-6 py-3 text-center font-medium text-white shadow-lg"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="rounded bg-secondary-dark px-6 py-3 text-center font-medium hover:bg-secondary"
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
    <div className="flex gap-3 rounded-xl bg-secondary-dark p-3">
      <div className="mt-0.5 text-primary">{icon}</div>
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-sm text-secondary-darker">{body}</div>
      </div>
    </div>
  );
}
