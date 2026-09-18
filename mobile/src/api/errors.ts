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
  const message = typeof anyErr.message === "string" ? anyErr.message : "";
  // fetch ağ/CORS hatasını ayırt edemez; "Failed to fetch" kullanıcıya şifre hatası gibi görünüyordu.
  if (message === "Failed to fetch" || message === "Network request failed" || message === "Load failed") {
    return "Sunucuya ulaşılamadı. İnternet bağlantınızı ve giriş ekranındaki sunucu adresini kontrol edin.";
  }
  if (message) return message;
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
