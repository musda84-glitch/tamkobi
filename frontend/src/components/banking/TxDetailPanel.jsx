import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { fmtDate, formatTrAmount } from "../../utils/money";
import { matchActorName, matchStatusLabel, txCreatedSourceLabel } from "../../utils/bankMatchLabel";
import { backdropDismissProps } from "../../utils/modalBackdrop";
import { ReceiptPrint } from "../ReceiptPrint";
import { TxRowMenu } from "../TxRowMenu";
import { TxMatchActions } from "./TxMatchActions";

function directionOf(tx) {
  if (tx?.type === "inflow") return { label: "Giriş", cls: "text-emerald-700 bg-emerald-50" };
  if (tx?.type === "outflow") return { label: "Çıkış", cls: "text-rose-700 bg-rose-50" };
  return { label: "Virman", cls: "text-indigo-700 bg-indigo-50" };
}

function amountText(tx) {
  const n = formatTrAmount(tx?.amount || 0);
  if (tx?.type === "inflow") return `+${n} ₺`;
  if (tx?.type === "outflow") return `-${n} ₺`;
  return `${n} ₺`;
}

function matchBadge(tx) {
  if (tx?.source !== "bank_sync") return null;
  if (tx.match_status === "rematching") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-slate-100 text-slate-500">Eşleştiriliyor…</span>;
  }
  if (tx.match_status === "matched") {
    return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-100 text-emerald-700">{matchStatusLabel(tx)}</span>;
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-500">EŞLEŞME BEKLİYOR</span>;
}

/** Sağ overlay: hareketin tam metni ve aynı eşleştirme butonları. */
export function TxDetailPanel({
  tx,
  accountLabel = "—",
  accounts = [],
  contacts = [],
  company,
  companyId,
  canEdit = false,
  onClose,
  onChanged,
}) {
  const [receipt, setReceipt] = useState(false);
  useEffect(() => {
    if (!tx) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (document.querySelector("[data-testid^='tx-match-modal-']")) return;
      if (document.querySelector("[data-testid='receipt-print-modal']")) return;
      onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tx, onClose]);

  if (!tx) return null;
  const txId = tx.id || tx._id;
  const dir = directionOf(tx);
  const created = txCreatedSourceLabel(tx);
  const matcher = matchActorName(tx);
  const description = tx.description || "";
  const contact = (contacts || []).find((c) => (c.id || c._id) === tx.contact_id) || {
    name: tx.contact_name || "",
    tax_number_or_id: "",
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-slate-900/30"
      {...backdropDismissProps(onClose)}
      data-testid="tx-detail-backdrop"
    >
      <aside
        className="h-full w-full max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col"
        data-testid="tx-detail-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">Hareket detayı</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="tx-detail-close" aria-label="Kapat">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 text-xs">
          <div className={`text-2xl font-bold tabular-nums ${tx.type === "inflow" ? "text-emerald-600" : tx.type === "outflow" ? "text-rose-600" : "text-indigo-600"}`} data-testid="tx-detail-amount">
            {amountText(tx)}
          </div>
          <dl className="grid grid-cols-[88px_1fr] gap-y-2 gap-x-2 text-slate-600">
            <dt className="text-slate-400">Tarih</dt>
            <dd className="font-medium text-slate-800">{fmtDate(tx.date)}</dd>
            <dt className="text-slate-400">Yön</dt>
            <dd><span className={`inline-flex px-2 py-0.5 rounded-md font-semibold ${dir.cls}`}>{dir.label}</span></dd>
            <dt className="text-slate-400">Hesap</dt>
            <dd className="font-medium text-slate-800">{accountLabel}</dd>
            <dt className="text-slate-400">Kategori</dt>
            <dd className="flex flex-wrap items-center gap-1">
              <span className="inline-flex px-2 py-0.5 rounded-md font-semibold bg-slate-100 text-slate-700">{tx.category || dir.label}</span>
              {matchBadge(tx)}
            </dd>
            <dt className="text-slate-400">Oluşturan</dt>
            <dd data-testid="tx-detail-created">{created || "—"}</dd>
            <dt className="text-slate-400">Eşleştiren</dt>
            <dd data-testid="tx-detail-matcher">{matcher || "—"}</dd>
          </dl>
          <div>
            <div className="text-[10px] uppercase font-semibold text-slate-400 mb-1">Açıklama</div>
            <p className="text-sm text-slate-800 whitespace-pre-wrap break-words" data-testid="tx-detail-desc">{description}</p>
          </div>
        </div>
        <div className="border-t border-slate-100 px-4 py-3 flex flex-wrap items-center gap-1.5">
          <TxMatchActions
            tx={tx}
            canEdit={canEdit}
            contacts={contacts}
            accounts={accounts}
            companyId={companyId}
            onChanged={onChanged}
            variant="full"
          />
          <button
            type="button"
            onClick={() => setReceipt(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
            data-testid={`tx-detail-print-${txId}`}
          >
            <Printer className="w-3.5 h-3.5" /> Yazdır
          </button>
          <TxRowMenu tx={tx} accounts={accounts} company={company} contacts={contacts} onChanged={onChanged} />
        </div>
      </aside>
      {receipt && (
        <ReceiptPrint tx={tx} contact={contact} company={company} onClose={() => setReceipt(false)} />
      )}
    </div>,
    document.body,
  );
}
