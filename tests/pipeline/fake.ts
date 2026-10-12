import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";
import { MODELS } from "@/lib/config";

type Params = Record<string, unknown>;

/** A stand-in client that returns queued responses and records each request. */
export function fakeClient(responses: object[], onCall?: (index: number) => void) {
  const requests: Params[] = [];
  const create = vi.fn(async (params: Params, options?: { signal?: AbortSignal }) => {
    void options;
    // Snapshot: the helper keeps appending to the same history array.
    requests.push(structuredClone(params));
    const next = responses.shift();
    if (!next) throw new Error("No more fake responses");
    onCall?.(requests.length);
    return next;
  });
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  return { client, requests, create };
}

export const usage = { input_tokens: 1000, output_tokens: 500 };

const thinking = { type: "thinking", thinking: "", signature: "sig" };

/** A normal response: a thinking block first, then the JSON as text. */
export function reply(json: unknown, extra: object = {}) {
  return {
    model: MODELS.opus,
    content: [thinking, { type: "text", text: JSON.stringify(json) }],
    stop_reason: "end_turn",
    stop_details: null,
    usage,
    ...extra,
  };
}

export const refusal = {
  model: MODELS.opus,
  content: [],
  stop_reason: "refusal",
  stop_details: { type: "refusal", category: "bio", explanation: "declined" },
  usage,
};

/** Every violation of the structured-output schema rules found in a JSON schema. */
export function wireSchemaProblems(schema: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Record<string, unknown>;
  const problems: string[] = [];
  for (const banned of ["minimum", "maximum", "minLength", "maxLength", "pattern", "$ref"]) {
    if (banned in node) problems.push(`${path}: uses ${banned}`);
  }
  if (typeof node.minItems === "number" && node.minItems > 1) problems.push(`${path}: minItems`);
  if (node.type === "object") {
    const properties = Object.keys((node.properties as object) ?? {});
    const required = (node.required as string[]) ?? [];
    if (node.additionalProperties !== false) problems.push(`${path}: allows extra properties`);
    for (const key of properties) {
      if (!required.includes(key)) problems.push(`${path}.${key}: not required`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      value.forEach((item, i) => problems.push(...wireSchemaProblems(item, `${path}.${key}[${i}]`)));
    } else if (value && typeof value === "object") {
      problems.push(...wireSchemaProblems(value, `${path}.${key}`));
    }
  }
  return problems;
}
