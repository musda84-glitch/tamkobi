import React from "react";
import { formatTrAmount } from "../../utils/money";
import { partnerSummaryCardMeta } from "../../utils/partnerTx";

const money = (n) => formatTrAmount(n || 0);

function StripCard({ testId, label, value, hint, tone = "light", onClick }) {
  const dark = tone === "dark";
  const cls = dark
    ? "bg-slate-900 text-white border-slate-900"
    : "bg-white text-slate-900 border-slate-200";
  const hintCls = dark ? "text-slate-300" : "text-slate-400";
  const valueCls = dark ? "text-white" : "text-slate-900";
  const amountLabel = `${money(value)} ₺`;
  const body = (
    <>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${dark ? "text-slate-300" : "text-slate-500"}`}>{label}</div>
      <div className={`text-base font-bold tabular-nums leading-tight whitespace-nowrap truncate ${valueCls}`} title={amountLabel}>{amountLabel}</div>
      {hint ? <div className={`text-[10px] leading-snug ${hintCls}`}>{hint}</div> : null}
    </>
  );
  const box = `min-w-0 rounded-xl border px-3 py-2.5 text-left ${cls}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${box} hover:border-slate-300`} data-testid={testId}>
        {body}
      </button>
    );
  }
  return (
    <div className={box} data-testid={testId}>
      {body}
    </div>
  );
}

/** Kompakt likidite şeridi. Değerler mevcut hesap ve ortak toplamlarından gelir. */
export function BankSummaryStrip({
  liquidity = 0,
  bank = 0,
  cash = 0,
  pos = 0,
  customerCards = 0,
  partnerSummary = null,
  onOpenPartners,
}) {
  const showPartners = Boolean(partnerSummary && partnerSummary.partner_count > 0);
  const meta = showPartners ? partnerSummaryCardMeta(partnerSummary) : null;
  const partnerAmount = meta ? `${formatTrAmount(meta.display)} ₺` : "";
  const gridCls = showPartners
    ? "grid gap-2 grid-cols-2 md:grid-cols-3 2xl:grid-cols-6"
    : "grid gap-2 grid-cols-2 md:grid-cols-3 2xl:grid-cols-5";
  return (
    <div className={gridCls} data-testid="bank-summary-strip">
      <StripCard
        testId="summary-liquidity"
        tone="dark"
        label="Toplam Likidite"
        value={liquidity}
        hint="Kredi kartı hariç kasa + banka + POS"
      />
      <StripCard testId="summary-bank" label="Banka" value={bank} />
      <StripCard testId="summary-cash" label="Kasa" value={cash} />
      <StripCard testId="summary-pos" label="POS" value={pos} />
      <StripCard testId="summary-customer-cards" label="Müşteri kartları" value={customerCards} />
      {showPartners && (
        <button
          type="button"
          onClick={onOpenPartners}
          className="min-w-0 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-left hover:border-amber-300"
          data-testid="partners-account-card"
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Ortaklar Hesabı</div>
          <div className={`text-base font-bold tabular-nums leading-tight whitespace-nowrap truncate ${meta.amountCls}`} data-testid="partners-account-balance" title={partnerAmount}>
            {partnerAmount}
          </div>
          <div className="text-[10px] text-slate-500" data-testid="partners-account-badge">
            {partnerSummary.partner_count} Ortak · {meta.label}
          </div>
        </button>
      )}
    </div>
  );
}
