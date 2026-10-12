/**
 * Loads a sample fridge illustration from disk so a live run on a sample can
 * send the same picture the visitor sees. Node-only: import from route handlers.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SampleId } from "../samples";
import type { ImageInput } from "./image";

export async function loadSampleImage(id: SampleId): Promise<ImageInput> {
  // `id` is one of a fixed list, so this path cannot leave the samples folder.
  const file = path.join(process.cwd(), "public", "samples", `${id}.png`);
  return { mediaType: "image/png", data: (await readFile(file)).toString("base64") };
}
