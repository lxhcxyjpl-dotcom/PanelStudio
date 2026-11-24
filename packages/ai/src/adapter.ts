import { AIIntentSchema, toJsonSchema, type AIProviderConfig } from "@panelstudio/contracts";
import { AiTransportError } from "./errors.js";
import { readStreamedReply } from "./streamed-reply.js";
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
  connectionTest?: boolean;
  onReplyText?: (text: string) => void;
  disableThinking?: boolean;
  replyFormat?: {name:string; schema:Record<string,unknown>};
}): Promise<string> {
  const problem = endpointProblem(input.config.baseUrl, input.config.allowLocalEndpoint);
  if (problem) throw new AiTransportError(problem);
  const fetchImpl = input.fetchImpl ?? fetch;
  const stream = Boolean(input.onReplyText && new URL(input.config.baseUrl).origin === "https://api.deepseek.com");
  const body = requestBody(input.config, input.messages, input.maxTokens, input.connectionTest === true, input.replyFormat, input.disableThinking === true);
  if (stream) body.stream = true;
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
      body: JSON.stringify(body),
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
  if (stream && response.headers.get("content-type")?.includes("text/event-stream"))
    return readStreamedReply(response, input.secret, input.onReplyText!, MAX_BODY_CHARS);
  const text = await response.text();
  if (text.length > MAX_BODY_CHARS) throw new AiTransportError("The provider response was too large.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new AiTransportError("The provider response was not a chat completion.");
  }
  const content = messageContent(decoded);
  if (content === null) throw new AiTransportError("The provider response was not a chat completion.");
  return scrub(content, input.secret);
}

export function pngDataUrl(bytes: Uint8Array): string {
  const binary = Buffer.from(bytes).toString("base64");
  return `data:image/png;base64,${binary}`;
}

function requestBody(config: AIProviderConfig, messages: ChatMessage[], maxTokens: number | undefined, connectionTest: boolean, replyFormat?: {name:string;schema:Record<string,unknown>}, disableThinking = false) {
  // JSON object and plain-text modes do not transmit a response schema on the wire.
  // Preserve the image blocks and give those models the same contract as strict providers.
  let wireMessages = messages;
  if (replyFormat && config.capabilities.structuredOutput !== "json_schema") {
    const instruction = "Return exactly one JSON object matching this schema. Use its exact property names and literal values.\n" + JSON.stringify(replyFormat.schema);
    const first = messages[0];
    wireMessages = first?.role === "system" && typeof first.content === "string"
      ? [{ ...first, content: first.content + "\n" + instruction }, ...messages.slice(1)]
      : [{ role: "system", content: instruction }, ...messages];
  }
  const body: Record<string, unknown> = {
    model: config.model,
    temperature: 0,
    messages: wireMessages,
  };
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  // Short probes and pre-upload clarifications need only the public answer.
  if ((connectionTest || disableThinking) && new URL(config.baseUrl).origin === "https://api.deepseek.com" &&
      ["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(config.model)) {
    body.thinking = { type: "disabled" };
  }
  const format = responseFormat(config, connectionTest, replyFormat);
  if (format) body.response_format = format;
  return body;
}

function responseFormat(config: AIProviderConfig, connectionTest: boolean, replyFormat?: {name:string;schema:Record<string,unknown>}): Record<string, unknown> | null {
  if (config.capabilities.structuredOutput === "json_schema") {
    return {
      type: "json_schema",
      json_schema: {
        name: replyFormat?.name ?? (connectionTest ? "ConnectionTest" : "AIIntent"),
        strict: true,
        schema: replyFormat?.schema ?? (connectionTest ? { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } : toJsonSchema(AIIntentSchema)),
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
