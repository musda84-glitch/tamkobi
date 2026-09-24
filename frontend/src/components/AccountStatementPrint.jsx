
import React, { useMemo } from "react";
import { Printer, X } from "lucide-react";
import { useEscape } from "../utils/useEscape";
import { fmtDate, fmtMoney } from "../utils/money";

export const txSignedAmount = (tx, accountId) => {
  const amt = Number(tx.amount) || 0;
  if (tx.type === "inflow") return amt;
  if (tx.type === "outflow") return -amt;
  if (tx.type === "transfer") {
    if (accountId && tx.account_id === accountId) return -amt;
    if (accountId && tx.target_account_id === accountId) return amt;
  }
  return amt;
};

export const buildAccountStatementRows = (txs, account) => {
  const accountId = account ? (account.id || account._id) : null;
  const chronological = [...(txs || [])].sort((a, b) => {
    const d = (a.date || "").localeCompare(b.date || "");
    if (d) return d;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });
  const net = chronological.reduce((s, tx) => s + txSignedAmount(tx, accountId), 0);
  let bal = account ? (Number(account.current_balance) || 0) - net : 0;
  const opening = bal;
  const rows = chronological.map((tx) => {
    const signed = txSignedAmount(tx, accountId);
    if (accountId) bal += signed;
    return { ...tx, signed, balance: accountId ? bal : null };
  });
  return { rows, opening, closing: accountId ? bal : null, net };
};

const typeLabel = (tx) => {
  if (tx.type === "inflow") return tx.category || "Tahsilat";
  if (tx.type === "outflow") return tx.category || "Tediye";
  if (tx.type === "transfer") return tx.category || "Virman";
  return tx.category || tx.type || "İşlem";
};

export const AccountStatementPrint = ({ company, account, title, transactions, onClose }) => {
  useEscape(onClose);
  const { rows, opening, closing } = useMemo(() => buildAccountStatementRows(transactions, account), [transactions, account]);
  const totIn = rows.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);
  const totOut = rows.filter((r) => r.signed < 0).reduce((s, r) => s + r.signed, 0);
  const ccy = account?.currency || company?.currency || "TRY";
  const money = (n) => fmtMoney(n, ccy);
  const subtitle = account
    ? `${account.bank_name || ""} — ${account.account_name || ""}`.trim()
    : title || "Tüm hesaplar";
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static" onClick={onClose}>
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl print:shadow-none print:rounded-none" onClick={(e) => e.stopPropagation()} data-testid="account-statement-print-modal">
        <div className="flex items-center justify-between px-5 py-3 border-b no-print print:hidden">
          <span className="text-xs font-bold text-slate-700">Hesap Ekstresi Önizleme</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="account-statement-print-now-btn">
              <Printer className="w-3.5 h-3.5" /> Yazdır / PDF Kaydet
            </button>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="account-statement-print-close"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div id="print-area" className="p-10 text-xs text-slate-800">
          <div className="flex justify-between items-start border-b-4 border-slate-900 pb-4">
            <div>
              <div className="text-lg font-bold">{company?.name}</div>
              <div className="text-slate-500">{company?.address} {company?.city}</div>
              <div className="text-slate-500">VD: {company?.tax_office} • VKN: {company?.tax_number}</div>
              <div className="text-slate-500">{company?.phone} • {company?.email}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black tracking-tight">HESAP EKSTRESİ</div>
              <div className="text-slate-500">Tarih: {new Date().toLocaleDateString("tr-TR")}</div>
              <div className="font-semibold text-slate-800 mt-1">{subtitle}</div>
              {account?.iban && account.iban !== "-" && <div className="font-mono text-slate-500">{account.iban}</div>}
            </div>
          </div>
          <table className="w-full mt-6 border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="text-left p-2 rounded-l">Tarih</th>
                <th className="text-left p-2">Hesap / Kasa</th>
                <th className="text-left p-2">İşlem</th>
                <th className="text-left p-2">Açıklama / Cari</th>
                <th className="text-right p-2">Tutar</th>
                {account && <th className="text-right p-2 rounded-r">Bakiye</th>}
              </tr>
            </thead>
            <tbody>
              {account && (
                <tr className="border-b border-slate-100 bg-slate-50 font-semibold">
                  <td className="p-2" colSpan={4}>Açılış bakiyesi</td>
                  <td className="p-2 text-right" />
                  <td className="p-2 text-right">{money(opening)}</td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id || r._id || i} className={`border-b border-slate-100 ${i % 2 ? "bg-slate-50" : ""}`}>
                  <td className="p-2 font-mono text-slate-500">{fmtDate(r.date)}</td>
                  <td className="p-2 font-semibold">{r.account_name}{r.type === "transfer" && r.target_account_name ? ` → ${r.target_account_name}` : ""}</td>
                  <td className="p-2">{typeLabel(r)}</td>
                  <td className="p-2">{[r.description, r.contact_name].filter(Boolean).join(" • ")}</td>
                  <td className={`p-2 text-right font-bold ${r.signed > 0 ? "text-emerald-700" : r.signed < 0 ? "text-rose-700" : "text-slate-700"}`}>
                    {r.signed > 0 ? "+" : ""}{money(r.signed)}
                  </td>
                  {account && <td className="p-2 text-right font-semibold">{money(r.balance)}</td>}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={account ? 6 : 5} className="p-6 text-center text-slate-400">Bu dönemde hareket yok.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-900 font-bold">
                <td className="p-2" colSpan={4}>TOPLAM · Giren +{money(totIn)} · Çıkan {money(totOut)}</td>
                <td className="p-2 text-right">{money(totIn + totOut)}</td>
                {account && <td className="p-2 text-right">{money(closing)}</td>}
              </tr>
            </tfoot>
          </table>
          {account && (
            <div className="mt-6 flex justify-end">
              <div className="rounded-xl px-4 py-3 text-right bg-slate-50 border border-slate-200">
                <div className="text-[10px] uppercase font-bold text-slate-400">Güncel Bakiye</div>
                <div className="text-xl font-black text-slate-900">{money(closing)}</div>
              </div>
            </div>
          )}
          <div className="mt-10 text-slate-400 italic">Bu ekstre {company?.name} tarafından {new Date().toLocaleString("tr-TR")} tarihinde oluşturulmuştur.</div>
        </div>
      </div>
    </div>
  );
};
