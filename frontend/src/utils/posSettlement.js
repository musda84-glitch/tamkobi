/** POS bloke çözümü: tutar, doğrulama ve özet. KDV/BSMV ayrımı yok. */

import { formatTrAmount } from "./money";

export const POS_COMMISSION_CATEGORY = "POS Komisyonu";
const TOL = 0.005;

export function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calcCommission(gross, net) {
  const g = round2(gross);
  const n = round2(net);
  if (!Number.isFinite(g) || !Number.isFinite(n)) return NaN;
  return round2(g - n);
}

/** brüt = net / (1 − oran). Oran 0 veya geçersizse brüt = net. */
export function grossFromRate(net, rate) {
  const n = round2(net);
  const r = Number(rate);
  if (!Number.isFinite(n)) return NaN;
  if (!Number.isFinite(r) || r <= 0 || r >= 1) return n;
  return round2(n / (1 - r));
}

export function commissionRate(gross, commission) {
  const g = Number(gross);
  const c = Number(commission);
  if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(c)) return 0;
  return c / g;
}

export function validatePosSettlement({ gross, net, commission, posBalance, isInflow }) {
  const errors = [];
  if (!isInflow) errors.push("POS bloke çözümü yalnızca giriş hareketlerinde yapılabilir.");
  const g = gross === "" || gross == null ? NaN : Number(gross);
  const n = net === "" || net == null ? NaN : Number(net);
  const c = commission === "" || commission == null ? NaN : Number(commission);
  if (!Number.isFinite(g)) errors.push("Brüt tutar girin.");
  if (!Number.isFinite(n)) errors.push("Bankaya gelen tutar geçersiz.");
  if (!Number.isFinite(c)) errors.push("Komisyon girin.");
  if (Number.isFinite(g) && Number.isFinite(n) && g + TOL < n) {
    errors.push("Brüt tutar bankaya gelen tutardan küçük olamaz.");
  }
  if (Number.isFinite(c) && c + TOL < 0) {
    errors.push("Komisyon negatif olamaz.");
  }
  const balance = posBalance == null || posBalance === "" ? null : Number(posBalance);
  if (Number.isFinite(g) && balance != null && Number.isFinite(balance) && g > balance + TOL) {
    errors.push("Brüt tutar POS bakiyesini aşıyor.");
  }
  return errors;
}

export function formatSummary({ posName, gross, net }) {
  const name = String(posName || "POS").trim() || "POS";
  return `${name} −${formatTrAmount(gross)} · Banka +${formatTrAmount(net)} · Masraf komisyon`;
}

export function isPosAccount(account) {
  const type = String(account?.type || "");
  return type === "pos" || type === "okc_pos";
}
