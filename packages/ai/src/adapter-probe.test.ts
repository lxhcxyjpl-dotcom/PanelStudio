import { expect, it } from "vitest";
import { VisualBatchSchema, toJsonSchema, type AIProviderConfig } from "@panelstudio/contracts";
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
it.each(["json_schema", "json_object", "text_json"] as const)("transmits the figure-reading contract in %s mode", async (mode) => {
  const schema = toJsonSchema(VisualBatchSchema);
  const messages = [
    { role: "system" as const, content: "Read the marks in this image." },
    { role: "user" as const, content: [{ type: "image_url" as const, image_url: { url: "data:image/png;base64,AA==" } }] },
  ];
  await postChatCompletion({
    config: { ...config, capabilities: { imageInput: true, structuredOutput: mode } },
    secret: "test-only-key", messages, replyFormat: { name: "FigureVisualReading", schema },
    fetchImpl: async (_url, options) => {
      const wire = JSON.parse(String(options?.body));
      expect(wire.messages[1]).toEqual(messages[1]);
      if (mode === "json_schema") {
        expect(wire.response_format.json_schema.schema).toEqual(schema);
        expect(wire.messages[0]).toEqual(messages[0]);
      } else {
        expect(wire.messages[0].content).toContain(JSON.stringify(schema));
        expect(wire.messages[0].content).toContain("Read the marks");
      }
      return Response.json({ choices: [{ message: { content: '{"items":[]}' } }] });
    },
  });
  expect(messages[0]!.content).toBe("Read the marks in this image.");
});
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
