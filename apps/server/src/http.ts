import type { FastifyReply, FastifyRequest } from "fastify";
import { ERROR_CODES, type ApiError, type ErrorCode } from "@panelstudio/contracts";

export class ApiException extends Error {
  readonly httpStatus: number;
  readonly code: ErrorCode;
  readonly details: ApiError["error"]["details"];

  constructor(
    code: ErrorCode,
    message: string,
    details: ApiError["error"]["details"] = {},
    httpStatus?: number,
  ) {
    super(message);
    this.name = "ApiException";
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus ?? ERROR_CODES[code].httpStatus ?? 500;
  }
}

export function errorBody(
  requestId: string,
  code: ErrorCode,
  message: string,
  details: ApiError["error"]["details"] = {},
): ApiError {
  return {
    error: {
      code,
      message,
      requestId,
      details,
    },
  };
}

export function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: ApiException,
): FastifyReply {
  return reply
    .status(error.httpStatus)
    .send(errorBody(request.id, error.code, error.message, error.details));
}

export function requireIdempotencyKey(request: FastifyRequest): string {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key !== "string" || key.trim().length === 0 || key.length > 200) {
    throw new ApiException("REQUEST_INVALID", "Idempotency-Key is required.");
  }
  return key;
}
