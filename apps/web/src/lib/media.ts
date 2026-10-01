import { MAX_ATTACHMENT_BYTES, MAX_VIDEO_BYTES } from "@tetris/config";

const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/i;
const INLINE_VIDEO = /^video\/(mp4|webm|quicktime|ogg|x-m4v)$/i;
const INLINE_AUDIO = /^audio\/(mpeg|mp3|mp4|ogg|opus|wav|x-wav|wave|webm|aac|x-m4a|m4a|flac)$/i;

/** Browsers often report "" for files they don't know; fall back to the extension. */
const BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  "3gp": "video/3gpp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  amr: "audio/amr",
  pdf: "application/pdf",
};

function ext(name: string) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** The MIME we record for a file: the browser's, else a guess from the name. */
export function mimeOf(file: { type: string; name: string }): string {
  const base = (file.type || "").split(";")[0]!.trim().toLowerCase();
  return base || BY_EXT[ext(file.name)] || "application/octet-stream";
}

export function mediaKind(mime: string, name = ""): "image" | "video" | "audio" | "file" {
  const m = mime && mime !== "application/octet-stream" ? mime : BY_EXT[ext(name)] || mime;
  if (INLINE_IMAGE.test(m)) return "image";
  if (INLINE_VIDEO.test(m)) return "video";
  if (INLINE_AUDIO.test(m)) return "audio";
  return "file";
}

/** Any video, including formats the browser cannot play (they are still capped). */
export function isVideoFile(file: { type: string; name: string }): boolean {
  const m = mimeOf(file);
  return m.startsWith("video/") || mediaKind(m, file.name) === "video";
}

/** Returns a user-facing reason this file can't be sent, or null when it's fine. */
export function attachmentProblem(file: File, format: (n: number) => string): string | null {
  if (file.size === 0) return "That file is empty.";
  if (isVideoFile(file)) {
    if (file.size > MAX_VIDEO_BYTES) {
      return `Videos can be up to ${format(MAX_VIDEO_BYTES)} here. That one is ${format(file.size)}. Trim or compress it first.`;
    }
    return null;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `Files can be up to ${format(MAX_ATTACHMENT_BYTES)}. That one is ${format(file.size)}.`;
  }
  return null;
}

export function isPdf(mime: string, name: string) {
  return mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

/** Tiny JPEG preview + real dimensions, computed locally before encryption. */
export async function imageMeta(
  file: File,
): Promise<{ width: number; height: number; thumb: string } | null> {
  if (mediaKind(mimeOf(file), file.name) !== "image" || mimeOf(file) === "image/svg+xml") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 40 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    const meta = {
      width: bitmap.width,
      height: bitmap.height,
      thumb: canvas.toDataURL("image/jpeg", 0.6),
    };
    bitmap.close();
    return meta;
  } catch {
    return null;
  }
}

/** Downscale a profile picture to a square JPEG under the server limit. */
export async function makeAvatar(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  canvas
    .getContext("2d")!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not process that image");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Rasterise an SVG data URL (e.g. a squiggle avatar) to a PNG the server accepts. */
export async function svgToPng(dataUrl: string, size = 256): Promise<Uint8Array> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d")!.drawImage(img, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not create that avatar");
  return new Uint8Array(await blob.arrayBuffer());
}
