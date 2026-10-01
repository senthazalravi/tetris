import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/ui/kit";
import { ThemeButton } from "@/ui/ThemeButton";
import { SiteFooter, type LegalPageId } from "@/ui/SiteFooter";

const TITLES: Record<LegalPageId, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  security: "Security",
};

export function Legal({
  page,
  onHome,
  onOpenLegal,
}: {
  page: LegalPageId;
  onHome: () => void;
  onOpenLegal: (id: LegalPageId) => void;
}) {
  return (
    <div className="relative h-full overflow-y-auto bg-bg">
      <div className="glow-lime pointer-events-none absolute inset-0 opacity-60" />
      <header className="relative mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <button
          type="button"
          onClick={onHome}
          className="inline-flex items-center gap-2 text-sm text-muted transition hover:text-fg"
        >
          <ArrowLeft size={16} />
          <Wordmark size={26} />
        </button>
        <ThemeButton />
      </header>

      <main className="relative mx-auto max-w-3xl px-6 pb-16">
        <p className="text-xs uppercase tracking-[0.18em] text-faint">Legal</p>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">{TITLES[page]}</h1>
        <p className="mt-3 text-sm text-muted">Last updated: 1 October 2026</p>

        <article className="prose-legal mt-10 space-y-8 text-[15px] leading-relaxed text-muted">
          {page === "privacy" && <PrivacyBody />}
          {page === "terms" && <TermsBody />}
          {page === "security" && <SecurityBody />}
        </article>
      </main>

      <SiteFooter onOpenLegal={onOpenLegal} />
    </div>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-xl font-bold text-fg">{children}</h2>;
}

function PrivacyBody() {
  return (
    <>
      <section className="space-y-3">
        <H>What Lop is</H>
        <p>
          Lop is a web messenger. Messages and files are end-to-end encrypted on your device before
          they are sent. We design the service so we cannot read your message or file contents.
        </p>
      </section>
      <section className="space-y-3">
        <H>Account information</H>
        <p>When you create an account we store:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Email address</li>
          <li>Username and display name</li>
          <li>Authentication proofs derived from your password (never your password itself)</li>
          <li>A verifier related to your vault passcode (never the passcode itself)</li>
          <li>Public cryptographic keys needed for encrypted messaging</li>
        </ul>
        <p>
          If you use “forgot password”, you confirm the email and @username on your account in the
          app. If your vault is still active you must also enter your vault passcode; if the vault
          was already wiped, email + username is enough to set a new account password. No reset
          email is sent. Your vault passcode itself cannot be recovered.
        </p>
      </section>
      <section className="space-y-3">
        <H>Messages and files</H>
        <p>
          Message bodies and file bytes are encrypted in your browser. The service stores ciphertext,
          delivery metadata (such as who sent what to whom, timestamps, and sizes), and encrypted
          attachment objects. Content keys travel inside the encrypted conversation, not in plaintext
          on the server.
        </p>
        <p>
          Messages and attachments are set to expire about 24 hours after they are sent. Expired data
          is removed from our systems as part of normal cleanup.
        </p>
      </section>
      <section className="space-y-3">
        <H>Local device data</H>
        <p>
          After you unlock with your vault passcode, decrypted chats may be held on your device in a
          sealed local store. Wrong or timed-out unlock attempts can wipe contacts and chats on the
          server and clear local conversation data on that device. Your account and profile can remain.
        </p>
      </section>
      <section className="space-y-3">
        <H>What we do not do</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>We do not require a phone number</li>
          <li>We do not sell your personal data</li>
          <li>We do not show ads inside Lop</li>
          <li>We do not provide a public people directory — lookup is by exact username only</li>
        </ul>
      </section>
      <section className="space-y-3">
        <H>Contact</H>
        <p>
          Questions about this policy:{" "}
          <a className="text-pop underline-offset-2 hover:underline" href="https://www.manasdutta.com/" target="_blank" rel="noreferrer">
            manasdutta.com
          </a>
          .
        </p>
      </section>
    </>
  );
}

function TermsBody() {
  return (
    <>
      <section className="space-y-3">
        <H>Agreement</H>
        <p>
          By creating an account or using Lop, you agree to these Terms of Service and our Privacy
          Policy. If you do not agree, do not use the service.
        </p>
      </section>
      <section className="space-y-3">
        <H>The service</H>
        <p>
          Lop provides end-to-end encrypted messaging on the web with automatic message expiry and a
          vault passcode unlock gate. Features may change as the product develops. The service is
          offered as-is, without a guarantee of uninterrupted availability.
        </p>
      </section>
      <section className="space-y-3">
        <H>Your responsibilities</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Keep your password and vault passcode secret</li>
          <li>Use Lop lawfully and respectfully</li>
          <li>Do not attempt to attack, abuse, or disrupt the service or other users</li>
          <li>Do not use Lop to distribute malware or content that is illegal where you are</li>
        </ul>
      </section>
      <section className="space-y-3">
        <H>Accounts, unlock, and wipes</H>
        <p>
          Unlocking requires your vault passcode within a short, one-attempt window. A wrong or late
          attempt can wipe your contacts and chats. Losing your passcode can mean permanent loss of
          those conversations. We cannot recover message plaintext for you.
        </p>
      </section>
      <section className="space-y-3">
        <H>Expiry</H>
        <p>
          Messages and attachments are designed to disappear after about 24 hours. Recipients may
          still hold copies on their own devices until expiry or local cleanup. Do not rely on Lop
          alone where you need long-term archives or legal retention.
        </p>
      </section>
      <section className="space-y-3">
        <H>Limitation of liability</H>
        <p>
          To the fullest extent permitted by law, Lop and its developer are not liable for indirect,
          incidental, or consequential damages, or for loss of messages, contacts, or access arising
          from wipe rules, expiry, misuse, or service interruption.
        </p>
      </section>
      <section className="space-y-3">
        <H>Changes</H>
        <p>
          We may update these terms. Continued use after changes are posted means you accept the
          updated terms. The “Last updated” date at the top of this page will change when we revise them.
        </p>
      </section>
    </>
  );
}

function SecurityBody() {
  return (
    <>
      <section className="space-y-3">
        <H>Encryption</H>
        <p>
          Conversations use a Signal-style design: X3DH for session setup and the Double Ratchet with
          AES-256-GCM for messages. Attachments are encrypted in the browser with a random per-file
          key; that key is sent inside the encrypted message envelope. The server is built to store
          ciphertext for content, not readable message or file plaintext.
        </p>
      </section>
      <section className="space-y-3">
        <H>Vault passcode</H>
        <p>
          Your vault passcode is separate from your account password and is never sent to the server.
          It protects local keys and sealed on-device data. The unlock window is short and single-attempt
          by design: failure can wipe communication state so a guessed passcode cannot casually open
          an old inbox.
        </p>
      </section>
      <section className="space-y-3">
        <H>What the server can still see</H>
        <p>
          End-to-end encryption protects content, not all metadata. The service may process things
          like account identifiers, usernames, approximate message times, delivery state, and
          attachment sizes. That is normal for a relay that delivers ciphertext.
        </p>
      </section>
      <section className="space-y-3">
        <H>Browser trust</H>
        <p>
          Like other web messengers, security depends on the integrity of the code running in your
          browser. Keep your browser updated. Prefer opening Lop only from the official site you
          trust. Compromised devices or malicious extensions can undermine any web app.
        </p>
      </section>
      <section className="space-y-3">
        <H>Reporting issues</H>
        <p>
          If you believe you have found a security problem, please reach out via{" "}
          <a className="text-pop underline-offset-2 hover:underline" href="https://www.manasdutta.com/" target="_blank" rel="noreferrer">
            manasdutta.com
          </a>{" "}
          or the project’s GitHub repository. Please do not publicly post exploit details before we
          have had a reasonable chance to respond.
        </p>
      </section>
    </>
  );
}
