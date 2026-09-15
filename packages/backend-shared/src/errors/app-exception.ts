import { HttpException, HttpStatus } from "@nestjs/common";

/** §104: every important error carries { error_code, message, retryable,
 * request_id }. Throw this directly when a route needs a specific
 * error_code/retryable pair; built-in Nest exceptions (UnauthorizedException
 * etc.) are still fine to throw and get a reasonable derived code from
 * AllExceptionsFilter, but AppException is for cases that need to be
 * precise about retryability. Lives here (not in services/api, where it
 * originated) because 5.6's OrderStateMachine -- itself shared, since
 * both services/api and services/worker transition orders -- throws it
 * too; a worker-side catch that needs `instanceof AppException` has to
 * import the same class both sides actually construct. */
export class AppException extends HttpException {
  readonly errorCode: string;
  readonly retryable: boolean;

  constructor(
    status: HttpStatus,
    errorCode: string,
    message: string,
    retryable: boolean = status >= 500,
  ) {
    super(message, status);
    this.errorCode = errorCode;
    this.retryable = retryable;
  }
}
