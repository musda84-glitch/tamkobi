import React from "react";
import { X, Printer } from "lucide-react";
import { fmtMoney } from "../utils/money";

export const ReceiptPrint = ({ tx, contact, company, onClose }) => {
  const isCollection = tx.type === "inflow";
  const isTransfer = tx.type === "transfer";
  const title = isCollection ? "Tahsilat Makbuzu" : isTransfer ? "Virman Makbuzu" : "Tediye (Ödeme) Makbuzu";
  const titleUpper = isCollection ? "TAHSİLAT MAKBUZU" : isTransfer ? "VİRMAN MAKBUZU" : "TEDİYE MAKBUZU";
  const partyLabel = isCollection ? "Sayın (Ödeyen)" : isTransfer ? "Karşı hesap / cari" : "Sayın (Alan)";
  const partyName = contact?.name || tx.contact_name || tx.target_account_name || "—";
  const totalLabel = isCollection ? "Yalnız tahsil edilen" : isTransfer ? "Yalnız virman tutarı" : "Yalnız ödenen";
  const ccy = tx.currency || contact?.currency || company?.currency || "TRY";
  const money = (n) => fmtMoney(n, ccy);
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl" data-testid="receipt-print-modal">
        <div className="flex items-center justify-between px-4 py-3 border-b no-print">
          <span className="text-xs font-bold text-slate-700">{title}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="receipt-print-btn"><Printer className="w-3.5 h-3.5" /> Yazdır</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="receipt-close-btn"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div id="print-area" className="p-8 text-xs text-slate-900">
          <div className="border-2 border-slate-900 rounded-lg p-6 space-y-4">
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3">
              <div><div className="text-base font-black">{company?.name}</div><div className="text-slate-500">{company?.address} {company?.city}</div><div className="text-slate-500">VD: {company?.tax_office} • VKN: {company?.tax_number} • {company?.phone}</div></div>
              <div className="text-right"><div className="text-lg font-black uppercase">{titleUpper}</div><div className="font-mono">No: MKB-{(tx.id || tx._id || "").slice(0, 8).toUpperCase()}</div><div className="text-slate-500">Tarih: {tx.date}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-[10px] uppercase text-slate-400 font-bold">{partyLabel}</div><div className="font-bold text-sm">{partyName}</div><div className="text-slate-500">VKN/TCKN: {contact?.tax_number_or_id || "—"}</div><div className="text-slate-500">{contact?.address} {contact?.city}</div></div>
              <div><div className="text-[10px] uppercase text-slate-400 font-bold">{isTransfer ? "Hesap" : "Ödeme Şekli"}</div><div className="font-semibold">{tx.account_name}</div><div className="text-slate-500">{tx.category}{tx.target_account_name ? ` → ${tx.target_account_name}` : ""}</div></div>
            </div>
            <table className="w-full border border-slate-300"><thead><tr className="bg-slate-100"><th className="text-left p-2 border-b border-slate-300">Açıklama</th><th className="text-right p-2 border-b border-slate-300">Tutar</th></tr></thead>
              <tbody><tr><td className="p-2">{tx.description}</td><td className="p-2 text-right font-bold">{money(tx.amount)}</td></tr></tbody>
              <tfoot><tr className="bg-slate-900 text-white"><td className="p-2 font-bold">{totalLabel} toplam</td><td className="p-2 text-right text-base font-black">{money(tx.amount)}</td></tr></tfoot></table>
            {typeof contact?.balance === "number" && <div className="text-slate-600">İşlem sonrası cari bakiye: <b>{money(Math.abs(contact.balance || 0))} {contact.balance > 0 ? "borç" : contact.balance < 0 ? "alacak" : ""}</b></div>}
            <div className="grid grid-cols-2 gap-8 pt-6">
              <div className="text-center"><div className="border-b border-slate-400 h-12"></div><div className="text-slate-500 mt-1">{isCollection ? "Teslim Eden" : "Teslim Alan"} (Kaşe / İmza)</div></div>
              <div className="text-center"><div className="border-b border-slate-400 h-12"></div><div className="text-slate-500 mt-1">{isCollection ? "Teslim Alan" : "Teslim Eden"} — {company?.name}</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
