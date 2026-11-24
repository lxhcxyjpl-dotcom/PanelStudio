import type { FastifyReply, FastifyRequest } from "fastify";
import { discussBrief } from "./figure-discussion.js";
import { ApiException, errorBody } from "./http.js";
import type { AppContext } from "./pipeline.js";

export async function openingResponse(ctx: AppContext, request: FastifyRequest, reply: FastifyReply) {
  const wantsStream = request.headers.accept?.includes("application/x-ndjson");
  const controller = new AbortController(), cancel = () => controller.abort();
  const socket = reply.raw;
  let started = false;
  socket.once("close", cancel);
  function write(event: object) {
    if (socket.destroyed || controller.signal.aborted) return;
    if (!started) {
      reply.hijack();
      socket.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no", Vary: "Accept" });
      started = true;
    }
    socket.write(JSON.stringify(event) + "\n");
  }
  try {
    const result = await discussBrief(ctx, request.body, controller.signal, wantsStream ? text => write({ type: "text", text }) : undefined);
    // Older clients and providers without streamed content keep the JSON contract.
    if (!started) return result;
    write({ type: "complete", result });
  } catch (error) {
    if (!started) throw error;
    const problem = error instanceof ApiException ? error : new ApiException("MODEL_OUTPUT_INVALID", "The response was interrupted.", {}, 502);
    write({ type: "error", status: problem.httpStatus, ...errorBody(request.id, problem.code, problem.message, problem.details) });
  } finally {
    socket.off("close", cancel);
    if (started && !socket.destroyed) socket.end();
  }
  return reply;
}
