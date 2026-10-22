/** Atölye iş ekranı: görüntüleme kilidi, ara sayım, geri alma süresi, devralma metni. */

const DEFAULT_SCRAP = [
  { code: "cut_error", label: "Kesim hatası" },
  { code: "material", label: "Malzeme" },
  { code: "machine", label: "Makine" },
  { code: "other", label: "Diğer" },
];

export function shopfloorMayOperate(user) {
  if (!user) return false;
  if (user.role === "admin" || user.is_super_admin) return true;
  const perms = user.permissions;
  if (perms && Object.prototype.hasOwnProperty.call(perms, "/atolye")) {
    const level = String(perms["/atolye"] || "");
    return level === "edit" || level === "delete";
  }
  return true;
}

export function shopfloorInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return `${first}${last}`.toLocaleUpperCase("tr");
}

export function partialForecast(current, add, planned) {
  const base = Number(current) || 0;
  const extra = Number(add) || 0;
  const plan = Number(planned) || 0;
  const next = base + extra;
  const left = plan > 0 ? Math.max(0, plan - next) : 0;
  return {
    next,
    left,
    over: plan > 0 && next > plan + 1e-9,
  };
}

export function undoCountdown(finishedAt, minutes, now = new Date()) {
  const start = new Date(finishedAt).getTime();
  const windowMin = Number(minutes);
  if (!Number.isFinite(start) || !Number.isFinite(windowMin) || windowMin <= 0) return null;
  const end = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(end)) return null;
  const left = start + windowMin * 60000 - end;
  if (left <= 0) return null;
  const total = Math.ceil(left / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function takeoverDetail(err) {
  const status = Number(err?.response?.status);
  const detail = err?.response?.data?.detail;
  if (status !== 409 || !detail || typeof detail !== "object") return null;
  if (String(detail.code || "") !== "takeover_confirm_required") return null;
  return detail;
}

export function takeoverTitle(detail, fallbackName) {
  const name = String(detail?.previous_operator || fallbackName || "").trim() || "başka bir operatör";
  return `Bu iş ${name} tarafından başlatıldı, devralınsın mı?`;
}

export function formatShopfloorClock(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "").trim();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return sameDay ? `bugün ${hh}:${mm}` : `${date.toLocaleDateString("tr-TR")} ${hh}:${mm}`;
}

export function normalizeScrapReasons(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const out = list
    .map((row) => ({
      code: String(row?.code || "").trim(),
      label: String(row?.label || "").trim(),
      active: row?.active !== false,
    }))
    .filter((row) => row.code && row.label && row.active);
  return out.length ? out : DEFAULT_SCRAP.map((row) => ({ ...row }));
}

export function focusJob(list, operatorName) {
  const rows = Array.isArray(list) ? list : [];
  const who = String(operatorName || "").trim();
  const running = rows.find((row) => row?.status === "in_progress" && who && String(row.operator_name || "") === who)
    || rows.find((row) => row?.status === "in_progress");
  if (running) return { mode: "running", job: running };
  const next = rows.find((row) => row?.status === "ready") || rows.find((row) => row?.status === "waiting");
  if (next) return { mode: "next", job: next };
  return null;
}

export function personnelCode(row) {
  const code = String(row?.personnel_no || row?.employee_code || row?.code || "").trim();
  return code;
}

export { DEFAULT_SCRAP };
