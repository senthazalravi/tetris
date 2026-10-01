import { Clock3, KeyRound, LockKeyhole, MessageCircleOff, ShieldCheck, Timer } from "lucide-react";
import { Button, LoopMark, Wordmark } from "@/ui/kit";
import { SiteFooter, type LegalPageId } from "@/ui/SiteFooter";
import { ThemeButton } from "@/ui/ThemeButton";

const POINTS = [
  {
    icon: LockKeyhole,
    title: "End-to-end encrypted",
    body: "Signal-grade X3DH and Double Ratchet. Text, photos, video and files are sealed in your browser. We only ever store ciphertext.",
  },
  {
    icon: Clock3,
    title: "Gone in 24 hours",
    body: "Every message and attachment expires a day after it is sent, on the server clock. Not when it's read. Not when you remember.",
  },
  {
    icon: KeyRound,
    title: "A vault passcode",
    body: "Separate from your password and never sent to us. Open Lop, and you get 30 seconds and one attempt to unlock.",
  },
  {
    icon: MessageCircleOff,
    title: "Wrong or late? Wiped.",
    body: "A wrong guess or a missed window clears your contacts and chats. Your account and profile stay. Nothing to recover, nothing to leak.",
  },
];

export function Landing({
  onLogin,
  onRegister,
  onOpenLegal,
}: {
  onLogin: () => void;
  onRegister: () => void;
  onOpenLegal: (id: LegalPageId) => void;
}) {
  return (
    <div className="relative h-full overflow-y-auto bg-bg">
      <div className="glow-lime pointer-events-none absolute inset-0" />
      <div className="dotgrid pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Wordmark size={30} />
        <div className="flex items-center gap-2">
          <ThemeButton />
          <Button variant="ghost" onClick={onLogin}>
            Sign in
          </Button>
          <Button onClick={onRegister} className="hidden sm:inline-flex">
            Create account
          </Button>
        </div>
      </header>

      <main className="relative mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-6 lg:grid-cols-[1.15fr_0.85fr] lg:pt-14">
        <section>
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-s1/70 px-3 py-1.5 text-[13px] text-muted backdrop-blur">
            <ShieldCheck size={14} className="text-pop" />
            Messages only. No phone number. No ads. No trace.
          </p>
          <h1 className="font-display text-[clamp(2.6rem,7vw,5.4rem)] font-extrabold leading-[0.95] tracking-[-0.03em]">
            Say it.
            <br />
            <span className="relative inline-block">
              Then let it
              <svg
                className="absolute -bottom-2 left-0 w-full text-pop"
                viewBox="0 0 300 12"
                fill="none"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path d="M2 8c60-8 120 4 190-2 40-3 80-2 106 2" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </span>{" "}
            vanish.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted">
            Lop is a private messenger for the web. Everything you send is encrypted before it
            leaves your browser, lives for exactly 24 hours, and sits behind a passcode that only
            you know.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={onRegister}>
              Create your account
            </Button>
            <Button size="lg" variant="soft" onClick={onLogin}>
              I already have one
            </Button>
          </div>
        </section>

        <section className="relative mx-auto flex w-full max-w-sm items-center justify-center py-6">
          <HeroRing />
        </section>
      </main>

      <section className="relative mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <article
            key={title}
            className="rounded-3xl border border-line bg-s1/80 p-6 backdrop-blur transition hover:-translate-y-0.5 hover:border-lines"
          >
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-s3 text-pop">
              <Icon size={19} />
            </div>
            <h3 className="font-display text-lg font-bold">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
          </article>
        ))}
      </section>

      <SiteFooter onOpenLegal={onOpenLegal} />
    </div>
  );
}

/** Purely decorative: the 24h loop, ticking. No fake conversations. */
function HeroRing() {
  return (
    <div className="relative aspect-square w-full max-w-[22rem]">
      <div className="absolute inset-0 rounded-full border border-line" />
      <div className="absolute inset-[9%] rounded-full border border-dashed border-lines" />
      <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="100" cy="100" r="86" fill="none" stroke="var(--s3)" strokeWidth="10" />
        <circle
          cx="100"
          cy="100"
          r="86"
          fill="none"
          stroke="var(--pop)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray="540"
          strokeDashoffset="140"
        />
      </svg>
      <div
        className="absolute inset-0"
        style={{ animation: "orbit 24s linear infinite" }}
        aria-hidden
      >
        <span className="absolute left-1/2 top-[7%] h-4 w-4 -translate-x-1/2 rounded-full bg-pop shadow-[0_0_30px_var(--pop)]" />
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <LoopMark size={54} className="text-fg" />
        <div className="mt-3 font-display text-5xl font-extrabold tabular tracking-tight">24h</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs uppercase tracking-[0.2em] text-muted">
          <Timer size={12} /> then it's gone
        </div>
      </div>
    </div>
  );
}
