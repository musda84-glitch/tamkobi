const PIN_RE = /^[0-9]{4}$/;

export type ShopfloorOperatorSession = {
  token: string;
  operator_name: string;
  operator_type: string;
  operator_id: string;
  expires_at: string;
};

type ErrLike = {
  status?: unknown;
  detail?: unknown;
  remaining_attempts?: unknown;
  body?: unknown;
  response?: { status?: unknown; data?: unknown };
};

function statusOf(err: unknown): number {
  if (!err || typeof err !== "object") return NaN;
  const e = err as ErrLike;
  if (typeof e.status === "number") return e.status;
  return Number(e.response?.status);
}

function dataOf(err: unknown): { detail?: unknown; remaining_attempts?: unknown } | null {
  if (!err || typeof err !== "object") return null;
  const e = err as ErrLike;
  if (e.body && typeof e.body === "object") return e.body as { detail?: unknown; remaining_attempts?: unknown };
  const resp = e.response?.data;
  if (resp && typeof resp === "object") return resp as { detail?: unknown; remaining_attempts?: unknown };
  if (e.detail !== undefined || e.remaining_attempts !== undefined) {
    return { detail: e.detail, remaining_attempts: e.remaining_attempts };
  }
  return null;
}

function detailString(err: unknown): string {
  const data = dataOf(err);
  if (typeof data?.detail === "string") return data.detail;
  if (err && typeof err === "object" && typeof (err as ErrLike).detail === "string") return (err as { detail: string }).detail;
  return "";
}

export function isAtolyeAccount(user: { account_type?: string } | null | undefined): boolean {
  return !!user && user.account_type === "atolye";
}

export function isSessionExpired(
  session: { expires_at?: string } | null | undefined,
  now: Date | string,
): boolean {
  if (!session || !session.expires_at) return true;
  const exp = Date.parse(session.expires_at);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(exp) || !Number.isFinite(current)) return true;
  return exp <= current;
}

export function operatorHeaders(session: { token?: unknown } | null | undefined): Record<string, string> {
  const token = session && typeof session.token === "string" ? session.token : "";
  if (!token) return {};
  return { "X-Shopfloor-Operator": token };
}

export function isValidPin(value: unknown): boolean {
  return typeof value === "string" && PIN_RE.test(value);
}

export function unlockErrorMessage(err: unknown): string {
  const status = statusOf(err);
  const data = dataOf(err);
  const detail = typeof data?.detail === "string" ? data.detail : "";
  if (status === 423 || status === 429) return detail;
  if (data && data.remaining_attempts != null && data.remaining_attempts !== "") {
    const left = Number(data.remaining_attempts);
    if (Number.isFinite(left)) {
      return `PIN hatalı: ${left} deneme hakkınız kaldı — 5 hatalı denemede 15 dk kilitlenir`;
    }
  }
  if (status === 400) return detail;
  return detail || "PIN doğrulanamadı.";
}

export function isOperatorSessionError(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== 401 && status !== 403) return false;
  return detailString(err).includes("Operatör oturumu");
}
