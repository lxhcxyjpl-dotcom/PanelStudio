import { expect, it } from "vitest";
import { readStreamedReply } from "./streamed-reply.js";

function sse(contents: string[], done = true) {
  return new Response(contents.map(content => "data: " + JSON.stringify({ choices:[{delta:{content}}] }) + "\n\n").join("") + (done ? "data: [DONE]\n\n" : ""));
}
it("skips private fields, handles JSON escapes and redacts a secret split between events", async () => {
  const result: string[] = [];
  const full = await readStreamedReply(sse(['{"kind":"question","reply":"A ', 'secret-', 'value and \\u', '4e2d?', '","request":"private context"}']), "secret-value", text => result.push(text), 10000);
  expect(result.join(" ")).not.toContain("secret-");
  expect(result.join(" ")).not.toContain("private context");
  expect(result.at(-1)).toBe("A [redacted] and 中?");
  expect(JSON.parse(full).reply).toBe(result.at(-1));
});
it("defers other property orders to the final answer, and rejects an abruptly closed stream", async () => {
  const result: string[] = [];
  const full = await readStreamedReply(sse(['{"options":["reply"],"reply":"visible"}']), "", text => result.push(text), 10000);
  expect(JSON.parse(full).reply).toBe("visible"); expect(result).toEqual([]);
  await expect(readStreamedReply(sse(['{"reply":"unfinished'], false), "", () => {}, 10000)).rejects.toThrow(/interrupted/);
});
