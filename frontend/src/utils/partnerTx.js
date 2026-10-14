/** Ortak hareket etiketleri.
 * Tek fonksiyon: Ortaklar Hesabı'na gelen = Giriş (+), çıkan/ödenen = Çıkış (−).
 * Kart = Toplam Giriş − Toplam Çıkış. Liste, tutar işareti ve seçici aynı deltayı kullanır.
 */

import { fmtDmy } from "./dateFormat";

export const PARTNER_TX_LABEL = {
  capital_in: "Giriş",
  withdrawal: "Çıkış",
  profit_share: "Giriş",
  credit: "Çıkış",
  debit: "Çıkış",
  salary: "Çıkış",
};

export function isPartnerExpenseTx(tx) {
  return Boolean(tx?.expense_id || tx?.source === "expense");
}

function effectOf(delta) {
  const rounded = Math.round(Number(delta) * 100) / 100;
  if (!Number.isFinite(rounded) || rounded === 0) return { delta: 0, side: "zero" };
  return { delta: rounded, side: rounded > 0 ? "giris" : "cikis" };
}

/** Backend partner_tx_effect. API balance_delta+side (giris/cikis) varsa onu kullanır. */
export function partnerTxEffect(tx) {
  if (!tx) return { delta: 0, side: "zero" };
  if (tx.balance_delta != null && tx.balance_delta !== "" && (tx.side === "giris" || tx.side === "cikis" || tx.side === "zero")) {
    const delta = Number(tx.balance_delta);
    return { delta: Number.isFinite(delta) ? Math.round(delta * 100) / 100 : 0, side: tx.side };
  }
  const amt = Number(tx.amount);
  const amount = Number.isFinite(amt) ? Math.abs(amt) : 0;
  if (tx.type === "profit_share") return effectOf(tx.is_paid ? 0 : amount);
  if (isPartnerExpenseTx(tx)) return effectOf(-amount);
  if (tx.type === "credit" || tx.type === "salary") return effectOf(-amount);
  if (tx.contact_id && tx.type === "withdrawal") return effectOf(amount);
  if (tx.contact_id && tx.type === "capital_in") return effectOf(-amount);
  if (tx.source === "bank_match" || tx.related_bank_tx_id) {
    const bankType = String(tx.bank_tx_type || "").toLowerCase();
    if (bankType === "outflow" || bankType === "debit") return effectOf(amount);
    if (bankType === "inflow" || bankType === "credit") return effectOf(-amount);
  }
  if (tx.type === "capital_in") return effectOf(amount);
  if (tx.type === "withdrawal" || tx.type === "debit") return effectOf(-amount);
  return effectOf(0);
}

/** Liste işareti: Giriş (pozitif delta). */
export function partnerTxIsCashInflow(tx) {
  return partnerTxEffect(tx).side === "giris";
}

/** İşlem sütunu: Giriş / Çıkış. */
export function partnerTxLabel(tx) {
  if (!tx) return "";
  const { side } = partnerTxEffect(tx);
  if (side === "giris") return "Giriş";
  if (side === "cikis") return "Çıkış";
  return "Denk";
}

/**
 * Ortak bakiyesi = cebindeki para (yazma):
 *   artı → Alacaklı (ortağa yazılan / çekilebilir)
 *   eksi → Borçlu (fazla çekmiş)
 * Kartta tutar her zaman mutlak değerdir; yön yalnızca Alacaklı / Borçlu etiketindedir.
 */
export function partnerBalanceMeta(balance) {
  const n = Number(balance);
  const amount = Number.isFinite(n) ? n : 0;
  if (amount > 0) {
    return {
      amount,
      abs: amount,
      display: amount,
      label: "Alacaklı",
      badge: "Alacaklı",
      hint: "",
      amountCls: "text-amber-700",
      badgeCls: "bg-amber-100 text-amber-800 border-amber-200",
      side: "credit",
    };
  }
  if (amount < 0) {
    return {
      amount,
      abs: Math.abs(amount),
      display: Math.abs(amount),
      label: "Borçlu",
      badge: "Borçlu",
      hint: "",
      amountCls: "text-rose-700",
      badgeCls: "bg-rose-100 text-rose-800 border-rose-200",
      side: "debit",
    };
  }
  return {
    amount: 0,
    abs: 0,
    display: 0,
    label: "Denk",
    badge: "Denk",
    hint: "",
    amountCls: "text-slate-800",
    badgeCls: "bg-slate-100 text-slate-600 border-slate-200",
    side: "zero",
  };
}

/**
 * Amber kart: backend present_partner_balance ile aynı sayı.
 * total_card_pocket imzalı ortak bakiyelerinin toplamıdır (kasa neti değil).
 */
export function partnerSummaryCardMeta(summary) {
  if (!summary) return { ...partnerBalanceMeta(0), cashIn: 0, cashOut: 0, fromCash: false };
  const hasPocket = summary.total_card_pocket != null && summary.total_card_pocket !== "";
  const pocket = hasPocket ? summary.total_card_pocket : summary.total_balance;
  const meta = partnerBalanceMeta(pocket);
  return {
    ...meta,
    cashIn: Number(summary.total_cash_in) || 0,
    cashOut: Number(summary.total_cash_out) || 0,
    fromCash: hasPocket,
  };
}

/** Seçici: işaret yok, mutlak tutar + Borçlu/Alacaklı, Türkçe biçim. */
export function partnerOptionLabel(partner) {
  const meta = partnerBalanceMeta(partner?.balance);
  const absRaw = partner?.balance_abs != null && partner.balance_abs !== "" ? Number(partner.balance_abs) : meta.abs;
  const abs = Number.isFinite(absRaw) ? absRaw : 0;
  const label = partner?.balance_label || meta.label;
  const share = partner?.share_percent ?? 0;
  const name = partner?.name || "Ortak";
  const amount = abs.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tag = label && label !== "Denk" ? ` ${label}` : "";
  return `${name} (Ortak • %${share} · ${amount} ₺${tag})`;
}
/** Kart bakiyesini artırır mı — partnerTxEffect ile aynı (Giriş). */
export function partnerTxIncreasesBalance(type, tx) {
  const base = tx && typeof tx === "object" ? { ...tx } : {};
  if (type) base.type = type;
  if (base.amount == null || base.amount === "") base.amount = 1;
  return partnerTxEffect(base).side === "giris";
}

export function partnerTxSign(type, tx) {
  if (tx && typeof tx === "object") {
    const { delta, side } = partnerTxEffect({ ...tx, type: type || tx.type });
    if (side === "giris" || delta > 0) return "+";
    if (side === "cikis" || delta < 0) return "-";
    return "";
  }
  return partnerTxIncreasesBalance(type, tx) ? "+" : "-";
}

/** Tek hareketin ortak bakiyesine net etkisi. */
export function partnerTxBalanceDelta(tx) {
  return partnerTxEffect(tx).delta;
}

/**
 * Seçili ortağın hareketlerinden bakiye mutabakatı.
 * Kart = Σ delta = Toplam Giriş − Toplam Çıkış.
 */
export function partnerLedgerBreakdown(txs, storedBalance) {
  const rows = Array.isArray(txs) ? txs : [];
  const buckets = {
    capital_in: 0,
    withdrawal: 0,
    credit: 0,
    debit: 0,
    salary: 0,
    profit_accrual: 0,
    profit_paid: 0,
    other: 0,
  };
  let ledger = 0;
  let cashIn = 0;
  let cashOut = 0;
  for (const tx of rows) {
    const amt = Number(tx.amount);
    const n = Number.isFinite(amt) ? amt : 0;
    const delta = partnerTxBalanceDelta(tx);
    ledger += delta;
    if (delta > 0) cashIn += delta;
    else if (delta < 0) cashOut += -delta;
    if (tx.type === "capital_in") buckets.capital_in += n;
    else if (tx.type === "withdrawal") buckets.withdrawal += n;
    else if (tx.type === "credit") buckets.credit += n;
    else if (tx.type === "debit") buckets.debit += n;
    else if (tx.type === "salary") buckets.salary += n;
    else if (tx.type === "profit_share" && !tx.is_paid) buckets.profit_accrual += n;
    else if (tx.type === "profit_share" && tx.is_paid) buckets.profit_paid += n;
    else buckets.other += n;
  }
  ledger = Math.round(ledger * 100) / 100;
  const stored = Number(storedBalance);
  const storedN = Number.isFinite(stored) ? Math.round(stored * 100) / 100 : 0;
  cashIn = Math.round(cashIn * 100) / 100;
  cashOut = Math.round(cashOut * 100) / 100;
  const girisDisplay = cashIn;
  const cikisDisplay = cashOut;
  const netDisplay = Math.round((girisDisplay - cikisDisplay) * 100) / 100;
  const cardDisplay = netDisplay;
  const cardPocket = netDisplay;
  return {
    count: rows.length,
    ledger,
    stored: storedN,
    drift: Math.abs(ledger - storedN) > 0.005,
    buckets,
    inflow: cashIn,
    outflow: cashOut,
    cashIn,
    cashOut,
    girisDisplay,
    cikisDisplay,
    netDisplay,
    cardDisplay,
    cardPocket,
    netMatchesCard: Math.abs(netDisplay - ledger) < 0.02,
  };
}

export function isPartnerLedgerType(type) {
  return type === "credit" || type === "debit" || type === "salary";
}

export function isPartnerCashType(type) {
  return type === "capital_in" || type === "withdrawal";
}

/** Kart üzerindeki maaş satırı: tutar yoksa «Belirle». */
export function partnerSalaryActionLabel(amount) {
  const n = Number(amount) || 0;
  return n > 0 ? null : "Belirle";
}

export function salaryDayOf(partner) {
  const fromField = Number(partner?.salary_day);
  if (fromField >= 1 && fromField <= 31) return fromField;
  const day = Number(String(partner?.salary_start_date || "").slice(8, 10));
  return day >= 1 && day <= 31 ? day : 1;
}

export function todayIsoDate() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Kaydet sonrası: vadesi gelmemişse tarihi söyle, gelmişse cebine yazıldı. */
export function partnerSalarySaveMessage(accrual, startDate) {
  if (Number(accrual?.posted_count) > 0) {
    const raw = accrual.message || "Aylık maaş cebine yazıldı.";
    return String(raw).replace(/ortak alacağına/gi, "cebine").replace(/alacağa/gi, "cebine");
  }
  const due = accrual?.scheduled_date
    || (accrual?.skipped || []).find((s) => s.reason === "not_due")?.due_date
    || (!accrual ? startDate : "");
  if (due) {
    return `Kaydedildi. ${fmtDmy(due)} tarihinde cebine yazılacak.`;
  }
  return accrual?.message || "Aylık maaş kaydedildi.";
}

/** Kartta tutar + her ayın hak ediş günü. */
export function partnerSalaryCardText(partner, formatAmount) {
  const n = Number(partner?.monthly_salary) || 0;
  if (n <= 0) return "Belirle";
  const amt = formatAmount ? formatAmount(n) : String(n);
  if (partner?.salary_recurring === false) return `${amt} ₺`;
  return `${amt} ₺ · her ayın ${salaryDayOf(partner)}'i`;
}
