import React, { useState } from "react";
import { BankMatchModal } from "../BankMatchModal";
import { formatTrAmount } from "../../utils/money";
import { confirmAndUnmatch, freshMatchSession, replaceMatchSession } from "./txMatchSession";

export function PosSettlementRowMark({ tx }) {
  if (tx?.match_kind !== "pos_settlement") return null;
  const txId = tx.id || tx._id;
  const name = tx.target_account_name || "";
  const number = tx.expense_number || "";
  const amount = formatTrAmount(tx.pos_commission || 0);
  return (
    <div className="mt-0.5 space-y-0.5" data-testid={`tx-pos-settlement-${txId}`}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[9px] px-1 rounded font-bold bg-amber-100 text-amber-800" data-testid={`tx-pos-chip-${txId}`}>POS bloke</span>
        {name ? <span className="text-[10px] text-slate-500" data-testid={`tx-pos-from-${txId}`}>← {name}</span> : null}
      </div>
      <div className="text-[10px] text-slate-500" data-testid={`tx-pos-expense-${txId}`}>
        ↳ Masraf · POS komisyonu{number ? ` (${number})` : ""}{"  "}{amount}
      </div>
    </div>
  );
}

const LABEL = {
  compact: { match: "Eşleştir", rematch: "Değiştir", unmatch: "Kaldır" },
  full: { match: "Eşleştir", rematch: "Eşleştirmeyi değiştir", unmatch: "Eşleştirmeyi kaldır" },
};

function RematchingBadge({ txId }) {
  return (
    <span
      className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-semibold bg-slate-100 text-slate-500 whitespace-nowrap"
      data-testid={`tx-rematching-${txId}`}
    >
      Eşleştiriliyor…
    </span>
  );
}

/**
 * bank_sync hareketi için 3 renkli eşleştirme butonu.
 * Yalnız source bank_sync ve canEdit. rematching rozet, buton yok.
 */
export function TxMatchActions({
  tx,
  canEdit = false,
  contacts = [],
  accounts = [],
  companyId,
  onChanged,
  variant = "compact",
}) {
  const [session, setSession] = useState(null);
  if (!tx || tx.source !== "bank_sync") return null;
  const txId = tx.id || tx._id;
  const labels = LABEL[variant] || LABEL.compact;
  const compact = variant !== "full";
  const btn = compact
    ? "inline-flex items-center justify-center rounded-lg px-1 py-1 text-[11px] font-semibold whitespace-nowrap shrink-0"
    : "inline-flex items-center justify-center rounded-lg px-2 py-1 text-[11px] font-semibold whitespace-nowrap";

  const openFresh = (e) => {
    e?.stopPropagation?.();
    setSession(freshMatchSession(tx));
  };
  const openReplace = (e) => {
    e?.stopPropagation?.();
    setSession(replaceMatchSession(tx));
  };
  const onRemove = async (e) => {
    e?.stopPropagation?.();
    const ok = await confirmAndUnmatch(tx);
    if (ok) onChanged?.();
  };

  let controls = null;
  if (tx.match_status === "rematching") {
    controls = <RematchingBadge txId={txId} />;
  } else if (canEdit && tx.match_status === "matched") {
    controls = (
      <>
        <button
          type="button"
          onClick={openReplace}
          className={`${btn} border border-emerald-300 bg-emerald-50 text-emerald-700`}
          data-testid={`tx-rematch-btn-${txId}`}
        >
          {labels.rematch}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className={`${btn} border border-rose-300 text-rose-600 bg-white`}
          data-testid={`tx-unmatch-btn-${txId}`}
        >
          {labels.unmatch}
        </button>
      </>
    );
  } else if (canEdit) {
    controls = (
      <button
        type="button"
        onClick={openFresh}
        className={`${btn} bg-amber-500 text-white`}
        data-testid={`tx-match-btn-${txId}`}
      >
        {labels.match}
      </button>
    );
  }

  return (
    <>
      {variant === "full" ? <PosSettlementRowMark tx={tx} /> : null}
      {controls ? (
        <span className={`inline-flex items-center gap-1 ${compact ? "shrink-0 whitespace-nowrap" : ""}`} data-testid={`tx-match-actions-${txId}`} onClick={(e) => e.stopPropagation()}>
          {controls}
        </span>
      ) : null}
      {session && (
        <BankMatchModal
          tx={session.tx}
          replace={session.replace}
          contacts={contacts}
          accounts={accounts}
          companyId={companyId}
          onClose={() => setSession(null)}
          onDone={(matched) => onChanged?.(matched)}
        />
      )}
    </>
  );
}
