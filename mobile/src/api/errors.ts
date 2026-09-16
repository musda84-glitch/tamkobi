export function apiErrorMessage(err: unknown, fallback = "İşlem başarısız."): string {
  if (!err || typeof err !== "object") return fallback;
  const anyErr = err as { message?: string; detail?: unknown; response?: { data?: { detail?: unknown } } };
  const detail = anyErr.response?.data?.detail ?? anyErr.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const joined = detail
      .map((item) => (typeof item === "string" ? item : item?.msg || item?.detail || ""))
      .filter(Boolean)
      .join(" ");
    if (joined) return joined;
  }
  if (typeof anyErr.message === "string" && anyErr.message && anyErr.message !== "Network request failed") {
    return anyErr.message;
  }
  return fallback;
}

export class ApiHttpError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}
