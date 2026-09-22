import React from "react";
import { X, Printer } from "lucide-react";
import { fmtMoney, moneySuffix } from "../utils/money";

const currencyName = (c) => ({ TRY: "Türk Lirası", USD: "Amerikan Doları", EUR: "Euro", GBP: "Sterlin", CHF: "İsviçre Frangı", JPY: "Japon Yeni" }[c] || c);
const moneyWords = (n, c) => `${fmtMoney(n, c).replace(` ${moneySuffix(c)}`, "")} ${currencyName(c)}`;

/** Taksit planından üretilen senetleri yazdırır (her senet ayrı sayfa). */
export const PromissoryPrint = ({ notes = [], contact, company, onClose }) => {
  if (!notes.length) return null;
  return (
    <div className="fixed inset-0 z-[85] bg-slate-900/70 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4" data-testid="promissory-print-modal">
        <div className="flex items-center justify-between px-4 py-3 border-b no-print sticky top-0 bg-white rounded-t-2xl z-10">
          <span className="text-xs font-bold text-slate-700">{notes.length} adet senet · yazdırma önizleme</span>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="promissory-print-btn">
              <Printer className="w-3.5 h-3.5" /> Yazdır
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="promissory-print-close"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div id="print-area" className="p-4 space-y-6">
          {notes.map((n, idx) => {
            const ccy = n.currency || contact?.currency || company?.currency || "TRY";
            return (
            <div key={n.id || n.number || idx} className="promissory-sheet border-2 border-slate-900 rounded-lg p-6 text-xs text-slate-900 break-inside-avoid" style={{ pageBreakAfter: idx < notes.length - 1 ? "always" : "auto" }}>
              <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 mb-4">
                <div>
                  <div className="text-base font-black">{company?.name || "—"}</div>
                  <div className="text-slate-500">{company?.address} {company?.city}</div>
                  <div className="text-slate-500">VD: {company?.tax_office || "—"} · VKN: {company?.tax_number || "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-black uppercase">Emre Yazılı Senet</div>
                  <div className="font-mono">No: {n.number}</div>
                  <div>Vade: <b>{n.due_date}</b></div>
                  <div>Keşide: {n.issue_date}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-[10px] uppercase text-slate-400 font-bold">Borçlu / Keşideci</div>
                  <div className="font-bold text-sm">{n.drawer_name || contact?.name || n.contact_name || "—"}</div>
                  <div className="text-slate-500">VKN/TCKN: {contact?.tax_number_or_id || "—"}</div>
                  <div className="text-slate-500">{contact?.address} {contact?.city}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400 font-bold">Lehtar</div>
                  <div className="font-bold text-sm">{company?.name || "—"}</div>
                  <div className="text-slate-500">{n.notes || "Taksit senedi"}</div>
                </div>
              </div>
              <div className="border border-slate-900 rounded-lg p-4 mb-4 bg-slate-50">
                <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Bedel</div>
                <div className="text-2xl font-black">{fmtMoney(n.amount, ccy)}</div>
                <div className="text-slate-600 mt-1">Yalnız {moneyWords(n.amount, ccy)}</div>
              </div>
              <p className="leading-relaxed mb-6">
                İşbu senet bedeli nakden/malan ahzolunmuştur. Vadesinde {company?.name || "lehtar"} veya emrine yukarıda yazılı tutarı
                kayıtsız şartsız ödeyeceğimi / ödeyeceğimizi kabul ve taahhüt ederim / ederiz.
              </p>
              <div className="grid grid-cols-2 gap-8 pt-4">
                <div className="text-center">
                  <div className="border-b border-slate-400 h-14" />
                  <div className="text-slate-500 mt-1">Lehtar (Kaşe / İmza)</div>
                </div>
                <div className="text-center">
                  <div className="border-b border-slate-400 h-14" />
                  <div className="text-slate-500 mt-1">Borçlu / Keşideci (İmza)</div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>
      <style>{`@media print { body * { visibility: hidden !important; } #print-area, #print-area * { visibility: visible !important; } #print-area { position: absolute; left: 0; top: 0; width: 100%; } .no-print { display: none !important; } .promissory-sheet { border: 2px solid #000 !important; } }`}</style>
    </div>
  );
};
