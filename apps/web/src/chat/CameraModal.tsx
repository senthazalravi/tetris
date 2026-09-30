import { useEffect, useRef, useState } from "react";
import { Camera, SwitchCamera } from "lucide-react";
import { Button, Modal } from "@/ui/kit";

/** Take a photo with the webcam. Nothing is uploaded until you send it (encrypted). */
export function CameraModal({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canFlip, setCanFlip] = useState(false);

  useEffect(() => {
    let live = true;
    setReady(false);
    setError(null);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't use the camera.");
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!live) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        setReady(true);
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        if (live) setCanFlip(cams.length > 1);
      } catch (e) {
        if (!live) return;
        const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        setError(
          denied
            ? "Camera access is blocked. Allow it in your browser's site settings and try again."
            : "No camera was found.",
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [facing]);

  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d")!;
    if (facing === "user") {
      // The preview is mirrored; save it the way the person sees themselves.
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
        onCapture(new File([blob], `photo-${stamp}.jpg`, { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <Modal title="Take a photo" onClose={onClose} wide>
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          ref={video}
          muted
          playsInline
          className={`aspect-video w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            Starting camera...
          </div>
        )}
        {error && (
          <div role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/85">
            {error}
          </div>
        )}
      </div>
      <div className="mt-4 flex items-center justify-center gap-3">
        <Button onClick={snap} disabled={!ready} className="min-w-40">
          <Camera size={18} /> Capture
        </Button>
        {canFlip && (
          <Button variant="soft" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} aria-label="Switch camera">
            <SwitchCamera size={18} />
          </Button>
        )}
      </div>
    </Modal>
  );
}
