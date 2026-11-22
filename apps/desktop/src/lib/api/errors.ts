export class ApiError extends Error {
  status: number;
  detail?: unknown;
  operationOutcome?: "not-started" | "not-applied" | "unknown";
  code?: string;
  operationId?: string;

  constructor(status: number, statusText: string, detail?: unknown, operationOutcome?: "not-started" | "not-applied" | "unknown", code?: string, operationId?: string) {
    const detailMessage = typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "";
    super(detailMessage ? `${status} ${statusText}: ${detailMessage}` : `${status} ${statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.operationOutcome = operationOutcome;
    this.code = code;
    this.operationId = operationId;
  }
}

export function apiErrorFromResponse(status: number, body: unknown) {
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : undefined;
  const detail = payload && "detail" in payload ? payload.detail : body;
  const outcome = payload?.operationOutcome;
  const code = payload?.code;
  const operationId = payload?.operationId;
  return new ApiError(
    status, "Local API error", detail,
    outcome === "not-started" || outcome === "not-applied" || outcome === "unknown" ? outcome : undefined,
    typeof code === "string" ? code.slice(0, 128) : undefined,
    typeof operationId === "string" && operationId.length <= 128 ? operationId : undefined,
  );
}

export function apiErrorFromNativeRejection(error: unknown) {
  if (error instanceof ApiError) return error;
  if (!error || typeof error !== "object" || !("status" in error) || !("code" in error)) return undefined;
  const { status, code } = error;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599 || typeof code !== "string") return undefined;
  return apiErrorFromResponse(status, error);
}
