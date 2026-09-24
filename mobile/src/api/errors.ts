const GATEWAY: Record<number, string> = {
  500: "Sunucu hatası. Biraz sonra tekrar deneyin.",
  502: "Sunucu geçici olarak yanıt vermiyor. Biraz sonra tekrar deneyin.",
  503: "Sunucu bakımda veya aşırı yüklü. Biraz sonra tekrar deneyin.",
  504: "Sunucu zaman aşımına uğradı. Biraz sonra tekrar deneyin.",
};

export function looksLikeHtml(value: string): boolean {
  const t = String(value || "").trim();
  return t.startsWith("<") || /<\/?(?:html|head|body|title|center|hr)\b/i.test(t.slice(0, 400));
}

function statusFromText(text: string): number | undefined {
  const m = /\b(50[234]|500)\b/.exec(text);
  return m ? Number(m[1]) : undefined;
}

const GENERIC_UPSTREAM = /service unavailable|bad gateway|gateway timeout|internal server error/i;

export function publicErrorMessage(raw: string | null | undefined, fallback = "İşlem başarısız.", status?: number): string {
  const text = String(raw || "").trim();
  if (looksLikeHtml(text) || GENERIC_UPSTREAM.test(text)) {
    const code = (status && GATEWAY[status] ? status : statusFromText(text)) || 502;
    return GATEWAY[code] || GATEWAY[502];
  }
  if (text) return text.length > 220 ? `${text.slice(0, 200).trim()}…` : text;
  if (status && GATEWAY[status]) return GATEWAY[status];
  return fallback;
}

export function apiErrorMessage(err: unknown, fallback = "İşlem başarısız."): string {
  if (!err || typeof err !== "object") return fallback;
  const anyErr = err as {
    message?: string;
    detail?: unknown;
    status?: number;
    response?: { status?: number; data?: { detail?: unknown } };
  };
  const status = typeof anyErr.status === "number" ? anyErr.status : anyErr.response?.status;
  const detail = anyErr.response?.data?.detail ?? anyErr.detail;
  if (typeof detail === "string" && detail.trim()) return publicErrorMessage(detail, fallback, status);
  if (Array.isArray(detail)) {
    const joined = detail
      .map((item) => (typeof item === "string" ? item : item?.msg || item?.detail || ""))
      .filter(Boolean)
      .join(" ");
    if (joined) return publicErrorMessage(joined, fallback, status);
  }
  const message = typeof anyErr.message === "string" ? anyErr.message : "";
  // fetch ağ/CORS hatasını ayırt edemez; "Failed to fetch" kullanıcıya şifre hatası gibi görünüyordu.
  if (message === "Failed to fetch" || message === "Network request failed" || message === "Load failed") {
    return "Sunucuya ulaşılamadı. İnternet bağlantınızı ve giriş ekranındaki sunucu adresini kontrol edin.";
  }
  if (message) return publicErrorMessage(message, fallback, status);
  return status && GATEWAY[status] ? GATEWAY[status] : fallback;
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
