/**
 * Checks an uploaded photo before it is sent anywhere. The browser has already
 * downscaled and re-encoded it, but the server trusts nothing: the declared
 * type must be on the allow-list, the payload must be real base64 of a sane
 * size, and its first bytes must be that image format's signature.
 */

export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Decoded size limit. A 1568 px JPEG is normally well under 1 MB. */
export const MAX_IMAGE_BYTES = 2_500_000;
/** Longest edge the browser downscales to before upload. */
export const MAX_IMAGE_EDGE = 1568;

export interface ImageInput {
  mediaType: MediaType;
  /** Base64 without a data-URL prefix. */
  data: string;
}

export type ImageCheck = { ok: true; bytes: number } | { ok: false; message: string };

function sniff(head: Uint8Array): MediaType | null {
  const starts = (...bytes: number[]) => bytes.every((byte, i) => head[i] === byte);
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  const ascii = (from: number, text: string) =>
    [...text].every((char, i) => head[from + i] === char.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

export function checkImage(image: { mediaType: string; data: string }): ImageCheck {
  if (!(MEDIA_TYPES as readonly string[]).includes(image.mediaType)) {
    return { ok: false, message: "Use a JPEG, PNG or WebP photo." };
  }
  const { data } = image;
  if (data.length < 16 || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return { ok: false, message: "The photo did not upload correctly. Try again." };
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = (data.length / 4) * 3 - padding;
  if (bytes > MAX_IMAGE_BYTES) {
    return { ok: false, message: "That photo is too large. Try a smaller one." };
  }
  const head = Uint8Array.from(atob(data.slice(0, 16)), (char) => char.charCodeAt(0));
  if (sniff(head) !== image.mediaType) {
    return { ok: false, message: "That file is not the kind of image it claims to be." };
  }
  return { ok: true, bytes };
}
