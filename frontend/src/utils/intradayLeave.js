/** Gün içi izin: çıkış–dönüş (HH:MM) doğrulama ve dakikaya çevirme. */

export function parseHm(t) {
  const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min, minutes: h * 60 + min, label: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` };
}

export function intradayLeaveMinutes(outTime, returnTime) {
  const a = parseHm(outTime);
  const b = parseHm(returnTime);
  if (!a || !b || b.minutes <= a.minutes) return null;
  return b.minutes - a.minutes;
}

export function validateIntradayLeave(reason, outTime, returnTime) {
  if ((reason || "").trim().length < 3) return "Gün içi izin nedeni en az 3 karakter olmalı.";
  if (!parseHm(outTime)) return "Çıkış saati HH:MM formatında olmalı.";
  if (!parseHm(returnTime)) return "Dönüş (giriş) saati HH:MM formatında olmalı.";
  if (intradayLeaveMinutes(outTime, returnTime) == null) return "Dönüş saati çıkış saatinden sonra olmalı.";
  return null;
}

export function intradayLeavePayload(reason, outTime, returnTime) {
  const out = parseHm(outTime);
  const ret = parseHm(returnTime);
  return {
    reason: (reason || "").trim(),
    ...(out ? { out_time: out.label } : {}),
    ...(ret ? { return_time: ret.label } : {}),
  };
}
