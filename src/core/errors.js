// core/errors.js — AppError hierarchy. Every error surfaces as RFC 9457 problem+json
// with a stable machine code (see docs/demo1/06-api-conventions.md §5).
export class AppError extends Error {
  constructor(status, code, title, detail, extra = {}) {
    super(detail || title);
    this.status = status;
    this.code = code;
    this.title = title;
    this.detail = detail || title;
    this.extra = extra;
  }
  toProblem(instance, requestId) {
    return {
      type: `https://docs.dms.example/errors/${this.code.toLowerCase()}`,
      title: this.title,
      status: this.status,
      code: this.code,
      detail: this.detail,
      instance,
      request_id: requestId,
      ...this.extra,
    };
  }
}

export const badRequest = (code, detail, extra) =>
  new AppError(400, code, 'Bad request', detail, extra);
export const unauthenticated = (detail = 'Missing or invalid credentials.') =>
  new AppError(401, 'UNAUTHENTICATED', 'Unauthenticated', detail);
export const forbidden = (detail = 'Not permitted.') =>
  new AppError(403, 'FORBIDDEN', 'Forbidden', detail);
// 404 is also returned for cross-tenant ids: never leak existence.
export const notFound = (what = 'Resource') =>
  new AppError(404, 'NOT_FOUND', 'Not found', `${what} not found.`);
export const conflict = (code, detail, extra) =>
  new AppError(409, code, 'Conflict', detail, extra);
export const validation = (errors, detail = 'One or more fields are invalid.') =>
  new AppError(422, 'VALIDATION_ERROR', 'Validation failed', detail, { errors });
export const businessRule = (code, detail, extra) =>
  new AppError(422, code, 'Business rule violation', detail, extra);
export const internal = (detail = 'An unexpected error occurred.') =>
  new AppError(500, 'INTERNAL_ERROR', 'Internal error', detail);
