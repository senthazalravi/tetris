import { Download } from "lucide-react";
import { promptInstall, useCanInstall } from "@/lib/install";

/**
 * Shown only while the browser can install the app (Chrome, Edge, Brave and
 * Android). Opens the browser's own install dialog, like the one on youtube.com.
 */
export function InstallButton({ className = "" }: { className?: string }) {
  const can = useCanInstall();
  if (!can) return null;
  return (
    <button
      type="button"
      onClick={() => void promptInstall()}
      title="Install Tetris as an app"
      className={`inline-flex h-9 items-center gap-2 rounded-full border border-line px-3.5 text-sm font-medium text-muted transition hover:bg-s3 hover:text-fg ${className}`}
    >
      <Download size={15} />
      Install app
    </button>
  );
}
