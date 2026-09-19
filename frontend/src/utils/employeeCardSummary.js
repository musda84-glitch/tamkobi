export const EMP_STATUS_LABEL = {
  active: "Aktif",
  on_leave: "İzinli",
  terminated: "İşten ayrıldı",
};

export function empStatusLabel(status) {
  if (!status) return "—";
  return EMP_STATUS_LABEL[status] || status;
}

export function formatTrDate(value) {
  const s = String(value || "").trim();
  if (!s) return "—";
  const iso = s.length >= 10 ? s.slice(0, 10) : s;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return s;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function performanceTone(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return "slate";
  if (n >= 80) return "emerald";
  if (n >= 50) return "amber";
  return "rose";
}

export function remainingTone(amount) {
  const n = Number(amount) || 0;
  if (n < 0) return "rose";
  if (n > 0) return "emerald";
  return "slate";
}
