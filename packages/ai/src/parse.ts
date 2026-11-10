import { AIIntentSchema, isAIIntent, type AIIntent } from "@panelstudio/contracts";
import { Errors } from "typebox/value";

export function parseModelJson(content: string): unknown {
  const trimmed = content.replace(/^\uFEFF/u, "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const raw = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("The model output is not JSON.");
  }
}

export function validateIntent(value: unknown): { ok: true; intent: AIIntent } | { ok: false; message: string } {
  if (isAIIntent(value)) return { ok: true, intent: value };
  const details = [...Errors(AIIntentSchema, value)]
    .slice(0, 4)
    .map((error) => {
      const path = "instancePath" in error && typeof error.instancePath === "string" ? error.instancePath : "/";
      const message = "message" in error && typeof error.message === "string" ? error.message : "invalid";
      return `${path || "/"} ${message}`;
    })
    .join("; ");
  return {
    ok: false,
    message: (details || "The model output did not match the intent schema.").slice(0, 500),
  };
}
