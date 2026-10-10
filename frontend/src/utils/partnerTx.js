/** Ortak hareket etiketleri ve işaretleri.
 * Kart tutarı = Giriş + Çıkış (işlem sütunu kasa neti).
 * Tip kovası (ledger) sapma kontrolü için; kart her zaman kasa netini gösterir.
 */

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

/**
 * İşlem sütunu yönü (kasa / ortak cebi bakışı) — bakiye etkisinden ayrı olabilir:
 * - Masraf / alacak fişi / maaş → Çıkış (şirket eksi); bakiye artar
 * - Cari tahsilat → ortak → Giriş (tahsilat); bakiye azalır
 * - Cari ödeme ← ortak → Çıkış
 * - Banka eşleşmesi: Vadesiz çıkışı → ortak cebine Giriş (etiket);
 *   bakiye tipi withdrawal (Alacaklı ↓) — #1089 capital_in terslemesi geri alındı
 * - Virman / para çek → Çıkış; sermaye → Giriş
 */
export function partnerTxIsCashInflow(tx) {
  if (!tx) return false;
  if (isPartnerExpenseTx(tx)) return false;
  // Ortak Alacak Fişi / aylık maaş: kasa/şirket yönü çıkış (eksi tutar)
  if (tx.type === "credit" || tx.type === "salary") return false;
  if (tx.contact_id && tx.type === "withdrawal") return true;
  if (tx.contact_id && tx.type === "capital_in") return false;
  // Banka eşleşmesi: etiket = bankanın karşı tarafı; bakiye tipi banka yönüyle aynı
  if (tx.source === "bank_match" || tx.related_bank_tx_id) {
    const bankType = String(tx.bank_tx_type || "").toLowerCase();
    if (bankType === "outflow" || bankType === "debit") return true; // Giriş
    if (bankType === "inflow" || bankType === "credit") return false; // Çıkış
    // bank_tx_type yoksa tip geçerli (outflow→withdrawal → Çıkış; etiket için bank_tx_type şart)
  }
  return partnerTxIncreasesBalance(tx.type, tx);
}

/** İşlem sütunu: yalnızca Giriş / Çıkış (kasa yönü). */
export function partnerTxLabel(tx) {
  if (!tx) return "";
  return partnerTxIsCashInflow(tx) ? "Giriş" : "Çıkış";
}

/**
 * Ortak bakiyesi = cebindeki para (yazma):
 *   artı → Alacaklı (ortağa yazılan / çekilebilir)
 *   eksi → Borçlu (fazla çekmiş)
 * Kartta yalnızca Alacaklı / Borçlu; Alacaklı tutar kasa eksi (−) gösterilir.
 */
export function partnerBalanceMeta(balance) {
  const n = Number(balance);
  const amount = Number.isFinite(n) ? n : 0;
  if (amount > 0) {
    return {
      amount,
      abs: amount,
      /** Kasa görünümü: Alacaklı → eksi tutar */
      display: -amount,
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
 * Amber kart / net özet: API kasa neti (total_card_pocket / total_cash_net) öncelikli.
 * Eski yanıtta yalnızca total_balance varsa ledger cebi kullanılır.
 */
export function partnerSummaryCardMeta(summary) {
  if (!summary) return partnerBalanceMeta(0);
  const pocketRaw = summary.total_card_pocket;
  if (pocketRaw != null && pocketRaw !== "") {
    const meta = partnerBalanceMeta(pocketRaw);
    const cashNet = Number(summary.total_cash_net);
    return {
      ...meta,
      display: Number.isFinite(cashNet) ? cashNet : meta.display,
      cashIn: Number(summary.total_cash_in) || 0,
      cashOut: Number(summary.total_cash_out) || 0,
      fromCash: true,
    };
  }
  const meta = partnerBalanceMeta(summary.total_balance);
  return { ...meta, cashIn: 0, cashOut: 0, fromCash: false };
}
/** Artı: ortak alacağı artar (para koy / alacak fişi / maaş / tahakkuk kâr payı). */
export function partnerTxIncreasesBalance(type, tx) {
  // Eski masraf satırı withdrawal yazılmış olsa bile alacak (bakiye artar)
  if (tx && isPartnerExpenseTx(tx)) return true;
  if (type === "capital_in" || type === "credit" || type === "salary") return true;
  // Tahakkuk kâr payı bakiyeyi artırır; peşin ödeme yalnızca kasadan çıkar.
  if (type === "profit_share") return !(tx && tx.is_paid);
  return false;
}

export function partnerTxSign(type, tx) {
  // Tablo işareti kasa yönüyle aynı (Giriş +, Çıkış −)
  if (tx && typeof tx === "object") {
    return partnerTxIsCashInflow({ ...tx, type: type || tx.type }) ? "+" : "-";
  }
  return partnerTxIncreasesBalance(type, tx) ? "+" : "-";
}

/** Tek hareketin ortak bakiyesine net etkisi. */
export function partnerTxBalanceDelta(tx) {
  if (!tx) return 0;
  const amt = Number(tx.amount);
  if (!Number.isFinite(amt)) return 0;
  // Masraf (expense) — tip withdrawal kalsa bile alacak (+)
  if (isPartnerExpenseTx(tx) || tx.type === "credit") return amt;
  if (partnerTxIncreasesBalance(tx.type, tx)) return amt;
  if (tx.type === "withdrawal" || tx.type === "debit") return -amt;
  return 0;
}

/**
 * Seçili ortağın hareketlerinden bakiye mutabakatı.
 * Kart tutarı = Giriş + Çıkış (kasa neti). Tip kovası (ledger) yalnızca sapma kontrolü.
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
    ledger += partnerTxBalanceDelta(tx);
    if (partnerTxIsCashInflow(tx)) cashIn += n;
    else cashOut += n;
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
  // Kart = işlem sonucu: Giriş(+) + Çıkış(−)
  const girisDisplay = cashIn;
  const cikisDisplay = Math.round(-cashOut * 100) / 100;
  const netDisplay = Math.round((girisDisplay + cikisDisplay) * 100) / 100;
  const cardDisplay = netDisplay;
  /** Alacaklı/Borçlu rozeti: kasa netinin tersi (eksi net → Alacaklı) */
  const cardPocket = Math.round(-netDisplay * 100) / 100;
  return {
    count: rows.length,
    ledger,
    stored: storedN,
    drift: Math.abs(ledger - storedN) > 0.005,
    buckets,
    /** @deprecated tip kovası; UI kasa yönünü kullanır */
    inflow: cashIn,
    outflow: cashOut,
    cashIn,
    cashOut,
    girisDisplay,
    cikisDisplay,
    netDisplay,
    cardDisplay,
    cardPocket,
    /** Kart her zaman Giriş+Çıkış */
    netMatchesCard: true,
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
    const [y, m, d] = String(due).slice(0, 10).split("-");
    const label = d && m && y ? `${d}.${m}.${y}` : due;
    return `Kaydedildi. ${label} tarihinde cebine yazılacak.`;
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
