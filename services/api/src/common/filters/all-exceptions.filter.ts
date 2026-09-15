import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { ApiError } from "@print-automated/types";
import { AppException } from "../errors/app-exception.js";
import { deriveErrorCode } from "../errors/derive-error-code.js";

interface RequestWithPinoLog extends Request {
  id: string | number;
  log: Logger;
}

/** §104: every response this API ever sends for an error is this exact
 * shape. Nothing downstream -- customer web, shop app, agent -- has to
 * guess at a second error format.
 *
 * request.id/request.log come from pino-http (wired in main.ts): every
 * request gets a generated id and a child logger already bound to it,
 * so a log line and the response body it corresponds to always carry
 * the same request_id without any extra plumbing here. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithPinoLog>();
    const requestId = String(request.id);

    const { status, errorCode, message, retryable } = this.resolve(exception);

    if (status >= 500) {
      // The real cause is logged server-side with full detail under the
      // same request_id the client receives; the client only ever sees
      // a safe, generic message -- never a stack trace or DB error string.
      request.log.error({ err: exception }, "Unhandled exception");
    } else {
      request.log.warn({ errorCode, status }, message);
    }

    const body: ApiError = {
      error_code: errorCode,
      message,
      retryable,
      request_id: requestId,
    };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    errorCode: string;
    message: string;
    retryable: boolean;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        errorCode: exception.errorCode,
        message: exception.message,
        retryable: exception.retryable,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const httpResponse = exception.getResponse();
      const message =
        typeof httpResponse === "string"
          ? httpResponse
          : ((httpResponse as { message?: string | string[] }).message ?? exception.message);
      return {
        status,
        errorCode: deriveErrorCode(exception.constructor.name),
        message: Array.isArray(message) ? message.join(" ") : message,
        retryable: status >= 500,
      };
    }

    // Anything else -- a Prisma connection failure, a thrown non-Error,
    // whatever -- is an unhandled 500. It is retryable by default: most
    // of what lands here is a transient infrastructure blip (DB/Redis/S3
    // briefly unreachable), not a permanent client-caused failure.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong on our end. Please try again.",
      retryable: true,
    };
  }
}
