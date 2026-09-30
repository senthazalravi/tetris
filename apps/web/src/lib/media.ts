const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
const INLINE_VIDEO = /^video\/(mp4|webm|quicktime|ogg)$/i;
const INLINE_AUDIO = /^audio\/(mpeg|mp4|ogg|wav|webm|aac|x-m4a)$/i;

export function mediaKind(mime: string): "image" | "video" | "audio" | "file" {
  if (INLINE_IMAGE.test(mime)) return "image";
  if (INLINE_VIDEO.test(mime)) return "video";
  if (INLINE_AUDIO.test(mime)) return "audio";
  return "file";
}

export function isPdf(mime: string, name: string) {
  return mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

/** Tiny JPEG preview + real dimensions, computed locally before encryption. */
export async function imageMeta(
  file: File,
): Promise<{ width: number; height: number; thumb: string } | null> {
  if (!INLINE_IMAGE.test(file.type)) return null;
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
