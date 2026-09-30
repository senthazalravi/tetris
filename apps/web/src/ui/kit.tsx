import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Loader2, X } from "lucide-react";
import { hueFor, initials } from "@/lib/format";

/* ---------------- brand ---------------- */

export function LoopMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <path
        d="M32 12a20 20 0 1 0 19.2 14.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <circle cx="49" cy="15" r="5" fill="var(--pop)" />
    </svg>
  );
}

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-fg">
      <LoopMark size={size} />
      <span
        className="font-display font-extrabold leading-none tracking-tight"
        style={{ fontSize: size * 0.95 }}
      >
        lop
      </span>
    </span>
  );
}

/* ---------------- avatar ---------------- */

export function Avatar({
  name,
  seed,
  url,
  size = 44,
}: {
  name: string;
  seed: string;
  url?: string | null;
  size?: number;
}) {
  const hue = hueFor(seed);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 select-none items-center justify-center rounded-full font-display font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(140deg, hsl(${hue} 62% 52%), hsl(${(hue + 40) % 360} 58% 38%))`,
      }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

/* ---------------- controls ---------------- */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "soft" | "danger";
  busy?: boolean;
  block?: boolean;
  size?: "sm" | "md" | "lg";
};

export function Button({
  variant = "primary",
  busy,
  block,
  size = "md",
  className = "",
  children,
  disabled,
  ...rest
}: BtnProps) {
  const base =
    "relative inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.98] disabled:opacity-55 disabled:active:scale-100";
  const sizes = {
    sm: "h-9 px-3 text-sm",
    md: "h-11 px-5 text-[15px]",
    lg: "h-13 px-6 text-base",
  }[size];
  const variants = {
    primary:
      "bg-accent text-onaccent shadow-[0_8px_24px_-10px_var(--pop)] hover:brightness-110",
    soft: "bg-s3 text-fg hover:bg-s4",
    ghost: "text-muted hover:bg-s3 hover:text-fg",
    danger: "bg-danger/15 text-danger hover:bg-danger/25",
  }[variant];
  return (
    <button
      className={`${base} ${sizes} ${variants} ${block ? "w-full" : ""} ${className}`}
      disabled={disabled || busy}
      {...rest}
    >
      {busy && <Loader2 size={16} className="spin" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-muted transition hover:bg-s3 hover:text-fg active:scale-95 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[13px] font-medium text-muted">{label}</span>
      <input
        className={`h-12 w-full rounded-xl border bg-s2 px-4 text-[15px] outline-none transition placeholder:text-faint focus:border-pop focus:ring-4 focus:ring-pop/15 ${
          error ? "border-danger" : "border-line"
        }`}
        {...rest}
      />
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

/* ---------------- overlay ---------------- */

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm fade-in sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal
        aria-label={title}
        className={`pop-in max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-s1 shadow-[var(--shadow)] outline-none sm:rounded-3xl ${
          wide ? "sm:max-w-lg" : "sm:max-w-md"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-s1/90 px-5 py-4 backdrop-blur">
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="-mr-2">
            <X size={18} />
          </IconButton>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- countdown ring ---------------- */

export function Ring({
  progress,
  size = 160,
  stroke = 8,
  tone = "pop",
  children,
}: {
  /** 1 → full, 0 → empty */
  progress: number;
  size?: number;
  stroke?: number;
  tone?: "pop" | "warn" | "danger" | "muted";
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = {
    pop: "var(--pop)",
    warn: "var(--warn)",
    danger: "var(--danger)",
    muted: "var(--faint)",
  }[tone];
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--s3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, progress)))}
          style={{ transition: "stroke 0.3s" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** Small "vanishes in" indicator on bubbles. */
export function LifeDot({ fraction }: { fraction: number }) {
  const size = 12;
  const r = 4.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90 opacity-70" aria-hidden>
      <circle cx={6} cy={6} r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={1.6} />
      <circle
        cx={6}
        cy={6}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(1, fraction)))}
      />
    </svg>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="spin text-muted" />;
}
