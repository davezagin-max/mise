/**
 * Browser-side photo preparation. A phone photo is several megabytes and far
 * larger than the model needs, so it is drawn onto a canvas at no more than
 * 1568 px on its long edge and re-encoded as JPEG before upload. That also
 * strips the EXIF block, so location data never leaves the phone.
 */
import { MAX_IMAGE_BYTES, MAX_IMAGE_EDGE, type ImageInput } from "./scan/image";

export interface PreparedPhoto {
  image: ImageInput;
  /** Object URL of the downscaled photo, for showing it back. Revoke it when done. */
  previewUrl: string;
}

/** The scale that fits `width` x `height` inside the long-edge limit. Never enlarges. */
export function fitScale(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): number {
  const longest = Math.max(width, height);
  return longest > maxEdge ? maxEdge / longest : 1;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not a photo.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser could not read that photo. Try a JPEG or PNG.");
  }
  const scale = fitScale(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, "image/jpeg", quality),
    );
    if (!blob) break;
    if (blob.size <= MAX_IMAGE_BYTES) {
      const data = toBase64(new Uint8Array(await blob.arrayBuffer()));
      return {
        image: { mediaType: "image/jpeg", data },
        previewUrl: URL.createObjectURL(blob),
      };
    }
  }
  throw new Error("That photo is too large to send, even after shrinking it.");
}
