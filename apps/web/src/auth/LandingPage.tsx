import { Link } from "react-router-dom";

export function LandingPage() {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-[var(--lop-accent)]">
          Lop
        </h1>
        <p className="mt-3 text-[var(--lop-muted)]">
          Private messaging. Nothing stays forever.
        </p>
        <div className="mt-10 flex flex-col gap-3">
          <Link
            to="/login"
            className="rounded-lg bg-[var(--lop-accent)] px-4 py-3 font-medium text-[#111]"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="rounded-lg border border-[var(--lop-border)] bg-[var(--lop-panel)] px-4 py-3 font-medium"
          >
            Create account
          </Link>
        </div>
      </div>
    </div>
  );
}
