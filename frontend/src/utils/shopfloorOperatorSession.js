const PIN_RE = /^[0-9]{4}$/;

export function isAtolyeAccount(user) {
  return !!user && user.account_type === "atolye";
}

export function operatorSessionKey(companyId, userId) {
  return `nx_sf_op:${companyId}:${userId}`;
}

function sessionPayload(session) {
  return {
    token: String(session?.token || ""),
    operator_name: String(session?.operator_name || ""),
    operator_type: String(session?.operator_type || ""),
    operator_id: String(session?.operator_id || ""),
    expires_at: String(session?.expires_at || ""),
  };
}

export function saveOperatorSession(companyId, userId, session) {
  const payload = sessionPayload(session);
  sessionStorage.setItem(operatorSessionKey(companyId, userId), JSON.stringify(payload));
  return payload;
}

export function loadOperatorSession(companyId, userId) {
  try {
    const raw = sessionStorage.getItem(operatorSessionKey(companyId, userId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const payload = sessionPayload(data);
    if (!payload.token) return null;
    return payload;
  } catch {
    return null;
  }
}

export function clearOperatorSession(companyId, userId) {
  sessionStorage.removeItem(operatorSessionKey(companyId, userId));
}

export function isSessionExpired(session, now) {
  if (!session || !session.expires_at) return true;
  const exp = Date.parse(session.expires_at);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(exp) || !Number.isFinite(current)) return true;
  return exp <= current;
}

export function operatorHeaders(session) {
  const token = session && typeof session.token === "string" ? session.token : "";
  if (!token) return {};
  return { "X-Shopfloor-Operator": token };
}

export function isValidPin(value) {
  return typeof value === "string" && PIN_RE.test(value);
}

export function unlockErrorMessage(err) {
  const status = Number(err?.response?.status);
  const data = err?.response?.data;
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

export function isOperatorSessionError(err) {
  const status = Number(err?.response?.status);
  if (status !== 401 && status !== 403) return false;
  const detail = err?.response?.data?.detail;
  return typeof detail === "string" && detail.includes("Operatör oturumu");
}
