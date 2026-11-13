import { expect, it } from "vitest";
import type { AIProviderConfig } from "@panelstudio/contracts";
import { postChatCompletion } from "./adapter.js";

const config: AIProviderConfig = { adapter: "openai-compatible", baseUrl: "https://api.deepseek.com", model: "deepseek-flash",
  capabilities: { imageInput: true, structuredOutput: "json_schema" }, allowLocalEndpoint: false };
async function request(overrides: Partial<AIProviderConfig>, connectionTest: boolean) {
  let sent: Record<string, unknown> = {};
  await postChatCompletion({ config: { ...config, ...overrides }, connectionTest, secret: "test-only-key", maxTokens: 64,
    messages: [{ role: "user", content: 'Reply with JSON {"ok":true} only.' }],
    fetchImpl: async (_url, options) => { sent = JSON.parse(String(options?.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }); },
  });
  return sent;
}
it("uses a short non-thinking probe and its own JSON schema for the documented DeepSeek endpoint", async () => {
  const body = await request({}, true);
  expect(body.thinking).toEqual({ type: "disabled" });
  expect(body.response_format).toMatchObject({ json_schema: { name: "ConnectionTest", schema: { required: ["ok"], additionalProperties: false } } });
});
it("does not send provider-specific fields to other hosts or unknown model aliases", async () => {
  expect((await request({ baseUrl: "https://api.deepseek.com.other.example/v1" }, true)).thinking).toBeUndefined();
  expect((await request({ model: "custom-alias" }, true)).thinking).toBeUndefined();
});
it("leaves regular layout requests on their original model defaults and intent schema", async () => {
  const body = await request({}, false);
  expect(body.thinking).toBeUndefined();
  expect(body.response_format).toMatchObject({ json_schema: { name: "AIIntent" } });
});
