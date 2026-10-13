import React from "react";
import { fmtDate, fmtMoney } from "../utils/money";
import { TxMobileCard, TxResponsiveList, TxTypeBadge, TX_WRAP_CLASS } from "./TxMobileCard";

function statementBadge(row) {
  if (row.kind === "payment") return { label: "Alacak", kind: "alacak" };
  if (row.kind === "cheque") return { label: row.credit ? "Alacak" : "Borç", kind: row.credit ? "alacak" : "borc" };
  if (row.credit && !row.debit) return { label: "Alacak", kind: "alacak" };
  if (row.debit) return { label: "Borç", kind: "borc" };
  return { label: "Hareket", kind: "other" };
}

function statementAmount(row, money) {
  if (row.debit) return { text: `-${money(row.debit)}`, cls: "text-rose-700" };
  if (row.credit) return { text: `+${money(row.credit)}`, cls: "text-emerald-700" };
  return { text: money(0), cls: "text-slate-700" };
}

export function StatementTxList({
  rows = [],
  currency = "TRY",
  tableTestId = "detail-statement-table",
  cardsTestId,
  rowTestId,
  showKindDot = false,
  emptyLabel = "Hareket yok.",
  emptyAmount = "—",
  cellPad = "py-1.5 px-2",
}) {
  const money = (n) => fmtMoney(n, currency);
  const cardsId = cardsTestId || `${tableTestId}-cards`;

  const cards = rows.length === 0 ? (
    <div className="text-center text-slate-400 py-6 text-xs">{emptyLabel}</div>
  ) : (
    rows.map((r, idx) => {
      const b = statementBadge(r);
      const amt = statementAmount(r, money);
      const id = rowTestId ? rowTestId(r, idx) : undefined;
      return (
        <TxMobileCard
          key={id || `${r.kind}-${idx}`}
          testId={id ? `${id}-card` : `${tableTestId}-card-${idx}`}
          date={fmtDate(r.date)}
          badge={<TxTypeBadge label={b.label} kind={b.kind} />}
          amount={amt.text}
          amountClassName={amt.cls}
          description={r.doc}
          extra={
            <div className={`text-[11px] font-bold ${Number(r.balance) > 0 ? "text-rose-700" : "text-emerald-700"}`}>
              Bakiye: {money(r.balance)}
            </div>
          }
        />
      );
    })
  );

  const table = (
    <table className={`w-full text-left ${TX_WRAP_CLASS}`} data-testid={tableTestId}>
      <thead className="bg-slate-50 border-b text-slate-500 uppercase font-semibold text-[10px]">
        <tr>
          <th className="py-2 px-2">Tarih</th>
          <th className="py-2 px-2">Belge / Açıklama</th>
          <th className="py-2 px-2 text-right">Borç</th>
          <th className="py-2 px-2 text-right">Alacak</th>
          <th className="py-2 px-2 text-right">Bakiye</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">{emptyLabel}</td></tr>}
        {rows.map((r, idx) => (
          <tr
            key={`${r.kind}-${idx}`}
            className={r.kind === "payment" ? "bg-emerald-50/40" : r.kind === "cheque" ? "bg-indigo-50/40" : ""}
            data-testid={rowTestId ? rowTestId(r, idx) : undefined}
          >
            <td className={`${cellPad} font-mono text-slate-500`}>{fmtDate(r.date)}</td>
            <td className={`${cellPad} font-semibold text-slate-800 ${TX_WRAP_CLASS}`}>
              {showKindDot ? (
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${r.kind === "payment" ? "bg-emerald-500" : "bg-rose-500"}`} />
              ) : null}
              {r.doc}
            </td>
            <td className={`${cellPad} text-right text-rose-700`}>{r.debit ? money(r.debit) : emptyAmount}</td>
            <td className={`${cellPad} text-right text-emerald-700`}>{r.credit ? money(r.credit) : emptyAmount}</td>
            <td className={`${cellPad} text-right font-bold ${r.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>{money(r.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <TxResponsiveList
      cards={cards}
      table={table}
      cardsTestId={cardsId}
      tableWrapTestId={`${tableTestId}-wrap`}
    />
  );
}

