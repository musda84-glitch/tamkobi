import React, { useState } from "react";
import { X, Printer } from "lucide-react";
import { fmtMoney, fmtDate } from "../utils/money";
import { printPageCss } from "../utils/printPageCss";
import { resolveImageUrl } from "../utils/imageUrl";
import { amountInWords } from "../utils/amountInWords";

const DASH = "—";

function filled(value) {
  const text = String(value ?? "").trim();
  return text || DASH;
}

function instrumentLabel(ch) {
  const kind = String(ch?.instrument || "").toLowerCase();
  if (kind === "cheque") return "Çek";
  if (kind === "promissory") return "Senet";
  return DASH;
}

function chequeNo(ch) {
  return filled(ch?.serial_no || ch?.number);
}

function bankBranch(ch) {
  const bank = String(ch?.bank_name || "").trim();
  const branch = String(ch?.bank_branch || "").trim();
  if (bank && branch) return `${bank} / ${branch}`;
  return filled(bank || branch);
}

function sumAmounts(rows) {
  const total = rows.reduce((sum, row) => sum + (Number(row?.amount) || 0), 0);
  return Math.round(total * 100) / 100;
}

function copyLabel(index) {
  return index === 0 ? "Asıl Nüsha" : `${index + 1}. Nüsha`;
}

function copyPages(count) {
  const n = Math.min(5, Math.max(1, Number(count) || 1));
  const pages = [];
  for (let i = 0; i < n; i += 2) {
    const page = [i];
    if (i + 1 < n) page.push(i + 1);
    pages.push(page);
  }
  return pages;
}

function receiptMeta(tx) {
  const isLedger = tx?.source === "ledger" || tx?.purpose === "balance_fix" || tx?.purpose === "ledger_slip";
  const isCreditSlip = isLedger && (tx?.slip_kind === "credit" || tx?.type === "inflow");
  const isCollection = !isLedger && tx.type === "inflow";
  const isTransfer = tx.type === "transfer";
  const title = isLedger
    ? (tx?.purpose === "balance_fix" || /bakiye\s*düzelt/i.test(tx?.description || "") || /cari bakiye düzeltme/i.test(tx?.category || "")
      ? (isCreditSlip ? "Cari Bakiye Düzeltme (Alacak)" : "Cari Bakiye Düzeltme (Borç)")
      : (isCreditSlip ? "Alacak Fişi" : "Borç Fişi"))
    : isCollection ? "Tahsilat Makbuzu" : isTransfer ? "Virman Makbuzu" : "Tediye (Ödeme) Makbuzu";
  const partyLabel = isLedger ? "Cari" : isCollection ? "Sayın (Ödeyen)" : isTransfer ? "Karşı hesap / cari" : "Sayın (Alan)";
  const totalLabel = isLedger ? "Yalnız fiş tutarı" : isCollection ? "Yalnız tahsil edilen" : isTransfer ? "Yalnız virman tutarı" : "Yalnız ödenen";
  return { isCollection, isTransfer, title, titleUpper: title.toLocaleUpperCase("tr-TR"), partyLabel, totalLabel };
}

function ReceiptBody({ tx, contact, company, items, copyIndex }) {
  const meta = receiptMeta(tx);
  const chequeItems = Array.isArray(items) && items.length ? items : null;
  const ccy = tx.currency || chequeItems?.[0]?.currency || contact?.currency || company?.currency || "TRY";
  const money = (n) => fmtMoney(n, ccy);
  const total = chequeItems ? sumAmounts(chequeItems) : (Number(tx.amount) || 0);
  const partyName = contact?.name || tx.contact_name || tx.target_account_name || DASH;
  const docNo = (tx.id || tx._id || "").slice(0, 8).toUpperCase();
  return (
    <div className="border-2 border-slate-900 rounded-lg p-4 space-y-3">
      <div className="flex justify-between items-start gap-3 border-b-2 border-slate-900 pb-3">
        <div className="flex items-start gap-2 min-w-0">
          {company?.logo_url && (
            <img
              src={resolveImageUrl(company.logo_url)}
              alt=""
              className="receipt-logo h-12 w-auto object-contain shrink-0"
              data-testid={copyIndex === 0 ? "receipt-logo" : undefined}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          )}
          <div className="min-w-0">
            <div className="text-sm font-black leading-tight">{company?.name}</div>
            <div className="text-slate-500">{company?.address} {company?.city}</div>
            <div className="text-slate-500">VD: {company?.tax_office} • VKN: {company?.tax_number} • {company?.phone}</div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-black uppercase leading-tight">{meta.titleUpper}</div>
          <div className="font-mono">No: MKB-{docNo}</div>
          <div className="text-slate-500">Tarih: {fmtDate(tx.date)}</div>
          <div className="mt-1 inline-block border border-slate-900 px-1.5 py-0.5 text-[10px] font-bold tracking-wide" data-testid={`receipt-copy-badge-${copyIndex}`}>{copyLabel(copyIndex)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] uppercase text-slate-400 font-bold">{meta.partyLabel}</div>
          <div className="font-bold text-sm">{partyName}</div>
          <div className="text-slate-500">VKN/TCKN: {contact?.tax_number_or_id || DASH}</div>
          <div className="text-slate-500">{contact?.address} {contact?.city}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-400 font-bold">{meta.isTransfer ? "Hesap" : "Ödeme Şekli"}</div>
          <div className="font-semibold">{tx.account_name}</div>
          <div className="text-slate-500">{tx.category}{tx.target_account_name ? ` → ${tx.target_account_name}` : ""}</div>
        </div>
      </div>
      {chequeItems ? (
        <>
          <table className="receipt-cheque-table w-full border border-slate-300 text-[10px]" data-testid={copyIndex === 0 ? "receipt-cheque-table" : undefined}>
            <colgroup>
              <col style={{ width: "8%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "14%" }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-100">
                <th className="text-left p-1 border-b border-slate-300">Tür</th>
                <th className="text-left p-1 border-b border-slate-300">Çek/Senet No</th>
                <th className="text-left p-1 border-b border-slate-300">Banka/Şube</th>
                <th className="text-left p-1 border-b border-slate-300">Hesap No/IBAN</th>
                <th className="text-left p-1 border-b border-slate-300">Keşideci</th>
                <th className="text-left p-1 border-b border-slate-300">Vade</th>
                <th className="text-right p-1 border-b border-slate-300">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {chequeItems.map((ch, idx) => (
                <tr key={ch.id || ch._id || `${chequeNo(ch)}-${idx}`} className="receipt-row">
                  <td className="p-1 border-b border-slate-200 break-words">{instrumentLabel(ch)}</td>
                  <td className="p-1 border-b border-slate-200 break-words">{chequeNo(ch)}</td>
                  <td className="p-1 border-b border-slate-200 break-words">{bankBranch(ch)}</td>
                  <td className="p-1 border-b border-slate-200 break-words">{filled(ch.account_no)}</td>
                  <td className="p-1 border-b border-slate-200 break-words">{filled(ch.drawer_name)}</td>
                  <td className="p-1 border-b border-slate-200 break-words">{ch.due_date ? fmtDate(ch.due_date) : DASH}</td>
                  <td className="p-1 border-b border-slate-200 text-right font-bold break-words">{money(ch.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="receipt-total flex justify-between items-center bg-slate-900 text-white px-2 py-1.5 font-bold" data-testid={copyIndex === 0 ? "receipt-doc-count" : undefined}>
            <span>Toplam {chequeItems.length} adet evrak</span>
            <span data-testid={copyIndex === 0 ? "receipt-grand-total" : undefined}>{money(total)}</span>
          </div>
        </>
      ) : (
        <table className="w-full border border-slate-300" data-testid={copyIndex === 0 ? "receipt-simple-table" : undefined}>
          <thead>
            <tr className="bg-slate-100">
              <th className="text-left p-2 border-b border-slate-300">Açıklama</th>
              <th className="text-right p-2 border-b border-slate-300">Tutar</th>
            </tr>
          </thead>
          <tbody>
            <tr className="receipt-row">
              <td className="p-2">{tx.description}</td>
              <td className="p-2 text-right font-bold">{money(tx.amount)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="receipt-total bg-slate-900 text-white">
              <td className="p-2 font-bold">{meta.totalLabel} toplam</td>
              <td className="p-2 text-right text-base font-black">{money(tx.amount)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <div className="font-semibold" data-testid={copyIndex === 0 ? "receipt-amount-words" : undefined}>{amountInWords(total, ccy)}</div>
      <div className="grid grid-cols-2 gap-8 pt-4">
        <div className="text-center">
          <div className="border-b border-slate-400 h-10" />
          <div className="text-slate-500 mt-1">{meta.isCollection ? "Teslim Eden" : "Teslim Alan"} (Kaşe / İmza)</div>
        </div>
        <div className="text-center">
          <div className="border-b border-slate-400 h-10" />
          <div className="text-slate-500 mt-1">{meta.isCollection ? "Teslim Alan" : "Teslim Eden"} — {company?.name}</div>
        </div>
      </div>
    </div>
  );
}

export const ReceiptPrint = ({ tx, contact, company, onClose, items }) => {
  const [copies, setCopies] = useState(1);
  const meta = receiptMeta(tx);
  const paper = copies >= 2 ? "A4" : "A5";
  const pages = copyPages(copies);
  const wide = Array.isArray(items) && items.length > 0;
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-4xl" : "max-w-xl"}`} data-testid="receipt-print-modal">
        <div className="flex items-center justify-between px-4 py-3 border-b no-print">
          <span className="text-xs font-bold text-slate-700">{meta.title}</span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
              Nüsha
              <select
                value={copies}
                onChange={(e) => setCopies(Number(e.target.value))}
                className="border border-slate-300 rounded-md px-1.5 py-1 bg-white"
                data-testid="receipt-copy-count"
                aria-label="Nüsha adedi"
              >
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="receipt-print-btn"><Printer className="w-3.5 h-3.5" /> Yazdır</button>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="receipt-close-btn"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <style data-testid="receipt-print-style">{printPageCss("receipt", paper)}</style>
        <div id="print-area" data-doc-type="receipt" data-paper={paper} className="p-4 text-xs text-slate-900 overflow-x-auto">
          {pages.map((page, pageIndex) => (
            <section
              key={page[0]}
              className={`receipt-page${pageIndex > 0 ? " receipt-print-only" : ""}`}
              data-testid="receipt-page"
              data-copy-count={page.length}
            >
              {page.map((copyIndex, idx) => (
                <React.Fragment key={copyIndex}>
                  {idx === 1 && (
                    <div className="receipt-cut receipt-print-only" data-testid="receipt-cut" aria-hidden="true">✂ kesiniz</div>
                  )}
                  <article className={`receipt-half${copyIndex > 0 ? " receipt-print-only" : ""}`} data-testid={`receipt-copy-${copyIndex}`}>
                    <ReceiptBody tx={tx} contact={contact} company={company} items={items} copyIndex={copyIndex} />
                  </article>
                </React.Fragment>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
