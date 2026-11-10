import { AIIntentSchema, toJsonSchema, type AIProviderConfig } from "@panelstudio/contracts";
import { AiTransportError } from "./errors.js";
import { chatCompletionsUrl, endpointProblem } from "./endpoint.js";

export type ChatContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: ChatContent;
};

const MAX_BODY_CHARS = 1_000_000;

export async function postChatCompletion(input: {
  config: AIProviderConfig;
  secret: string;
  messages: ChatMessage[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  maxTokens?: number;
}): Promise<string> {
  const problem = endpointProblem(input.config.baseUrl, input.config.allowLocalEndpoint);
  if (problem) throw new AiTransportError(problem);
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(chatCompletionsUrl(input.config.baseUrl), {
      method: "POST",
      redirect: "manual",
      signal: input.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.secret}`,
      },
      body: JSON.stringify(requestBody(input.config, input.messages, input.maxTokens)),
    });
  } catch (error) {
    if (isTimeout(error)) throw new AiTransportError("The provider request timed out.");
    if (isAbort(error)) throw error;
    throw new AiTransportError("The provider request failed.");
  }
  if (response.status === 0 || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    throw new AiTransportError("The provider redirected the request.");
  }
  if (!response.ok) {
    throw new AiTransportError(`The provider rejected the request (HTTP ${response.status}).`);
  }
  const text = await response.text();
  if (text.length > MAX_BODY_CHARS) throw new AiTransportError("The provider response was too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AiTransportError("The provider response was not a chat completion.");
  }
  const content = messageContent(body);
  if (content === null) throw new AiTransportError("The provider response was not a chat completion.");
  return scrub(content, input.secret);
}

export function pngDataUrl(bytes: Uint8Array): string {
  const binary = Buffer.from(bytes).toString("base64");
  return `data:image/png;base64,${binary}`;
}

function requestBody(config: AIProviderConfig, messages: ChatMessage[], maxTokens: number | undefined) {
  const body: Record<string, unknown> = {
    model: config.model,
    temperature: 0,
    messages,
  };
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  const format = responseFormat(config);
  if (format) body.response_format = format;
  return body;
}

function responseFormat(config: AIProviderConfig): Record<string, unknown> | null {
  if (config.capabilities.structuredOutput === "json_schema") {
    return {
      type: "json_schema",
      json_schema: {
        name: "AIIntent",
        strict: true,
        schema: toJsonSchema(AIIntentSchema),
      },
    };
  }
  if (config.capabilities.structuredOutput === "json_object") return { type: "json_object" };
  return null;
}

function messageContent(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("choices" in body)) return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
  return text.length > 0 ? text : null;
}

function scrub(value: string, secret: string): string {
  return secret ? value.split(secret).join("[redacted]") : value;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError" && error.message.toLowerCase().includes("timeout"));
}
