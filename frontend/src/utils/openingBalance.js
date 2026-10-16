/** Kasa/banka açılış-devir: hesap uygunluğu, varsayılan gün, bakiye önizlemesi. */

import { formatTrAmount } from "./money";

export const OPENING_ACCOUNT_TYPES = new Set(["cash_box", "bank", "pos", "okc_pos", "credit_card"]);

export function openingEligible(acc) {
  if (!acc || typeof acc !== "object") return false;
  if (acc.type === "credit_card" && acc.is_customer_card_pool) return false;
  return OPENING_ACCOUNT_TYPES.has(String(acc.type || ""));
}

export function istanbulToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

export function dayBeforeIso(isoDay) {
  const raw = String(isoDay || "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(dt.getTime())) return "";
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return "";
  dt.setUTCDate(dt.getUTCDate() - 1);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function earliestAccountTxDay(txs, accountId) {
  const aid = String(accountId || "");
  let min = "";
  (txs || []).forEach((tx) => {
    if (!tx) return;
    const onAccount = String(tx.account_id || "") === aid || String(tx.target_account_id || "") === aid;
    if (!onAccount) return;
    const raw = String(tx.date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
    if (!min || raw < min) min = raw;
  });
  return min;
}

export function defaultOpeningDate(txs, accountId, todayIso) {
  const first = earliestAccountTxDay(txs, accountId);
  if (first) {
    const prev = dayBeforeIso(first);
    if (prev) return prev;
  }
  const today = String(todayIso || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(today)) return today;
  return istanbulToday();
}

export function openingPreview(currentBalance, amount) {
  const cur = Number(currentBalance);
  const base = Number.isFinite(cur) ? cur : 0;
  const amt = Number(amount);
  if (!Number.isFinite(amt) || Math.abs(amt) < 0.009) return "";
  const next = Math.round((base + amt) * 100) / 100;
  return `Bakiye ${formatTrAmount(base)} → ${formatTrAmount(next)} olur, cari etkilenmez`;
}
