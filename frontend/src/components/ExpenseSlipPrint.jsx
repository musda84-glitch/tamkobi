import React, { useEffect, useState } from "react";
import { X, Printer } from "lucide-react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";

/**
 * VUK 225 / md.234 örnek formuna yakın gider pusulası yazdırma.
 * Zorunlu alanlar: işin mahiyeti, cins/miktar/bedel, taraflar, adres,
 * VD+hesap no (varsa), seri-sıra no, tarih, tevkifat oranı + net tutar; iki nüsha.
 */
const fmt = (n) => formatTrAmount(Number(n) || 0);

export function ExpenseSlipPrint({ doc, company, onClose, onPrinted }) {
  const [seller, setSeller] = useState(null);
  const companyId = company?.id || company?._id || doc?.company_id;
  const items = doc?.items || [];
  const number = doc?.invoice_number || "";
  const issueDate = doc?.issue_date || String(doc?.created_at || "").slice(0, 10);

  useEffect(() => {
    const cid = doc?.contact_id;
    if (!cid || !companyId) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/contacts?company_id=${companyId}&lite=1`).then((r) => {
      if (cancelled) return;
      const rows = Array.isArray(r.data) ? r.data : [];
      setSeller(rows.find((c) => (c.id || c._id) === cid) || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [doc?.contact_id, companyId]);

  const sellerName = doc?.contact_name || seller?.name || seller?.company_title || "—";
  const sellerAddress = [seller?.address, seller?.district, seller?.city].filter(Boolean).join(" ")
    || doc?.shipping_address || doc?.address || "";
  const sellerTaxOffice = seller?.tax_office || doc?.contact_tax_office || "";
  const sellerTaxId = seller?.tax_number_or_id || doc?.contact_tax_id || "";

  const buyerName = company?.name || "—";
  const buyerAddress = [company?.address, company?.city].filter(Boolean).join(" ");
  const buyerTaxOffice = company?.tax_office || "";
  const buyerTaxId = company?.tax_number || "";

  const subtotal = Number(doc?.subtotal ?? 0);
  const vatTotal = Number(doc?.vat_total ?? 0);
  const whRate = Number(doc?.withholding_rate ?? 0);
  const whAmount = Number(doc?.withholding_amount ?? 0);
  const grand = Number(doc?.grand_total ?? 0);
  const netPaid = Math.max(0, grand); // invoice_document_totals already nets withholding into grand

  const whLabel = whRate > 0
    ? (whRate <= 1 ? `${Math.round(whRate * 10)}/10` : `%${whRate}`)
    : "";

  const doPrint = () => {
    window.print();
    try { onPrinted?.(doc); } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/70 flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl print:shadow-none print:rounded-none" data-testid="expense-slip-print">
        <div className="flex items-center justify-between px-5 py-3 border-b no-print print:hidden">
          <span className="text-xs font-bold text-slate-700">Gider Pusulası Yazdırma — VUK md.234 / 225 Tebliğ</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={doPrint} className="flex items-center gap-1 px-3 py-1.5 bg-rose-700 text-white rounded-lg text-xs font-semibold" data-testid="expense-slip-print-btn">
              <Printer className="w-3.5 h-3.5" /> Yazdır (2 nüsha)
            </button>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="expense-slip-print-close"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <style>{`
          @media print {
            @page { size: A4; margin: 10mm; }
            .expense-slip-copy + .expense-slip-copy { page-break-before: always; }
            .no-print { display: none !important; }
          }
        `}</style>

        {[1, 2].map((copy) => (
          <div key={copy} className={`expense-slip-copy p-8 text-[11px] text-slate-900 ${copy === 2 ? "border-t-2 border-dashed border-slate-300 print:border-0" : ""}`} data-testid={`expense-slip-copy-${copy}`}>
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 mb-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Düzenleyen (Satın Alan / İşi Yaptıran)</div>
                <div className="text-base font-black mt-0.5" data-testid="expense-slip-buyer-name">{buyerName}</div>
                {buyerAddress && <div className="text-slate-600 mt-0.5">{buyerAddress}</div>}
                {(buyerTaxOffice || buyerTaxId) && (
                  <div className="text-slate-600 mt-0.5">
                    {buyerTaxOffice && <>VD: {buyerTaxOffice}</>}
                    {buyerTaxOffice && buyerTaxId && " · "}
                    {buyerTaxId && <>VKN/TCKN: {buyerTaxId}</>}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-xl font-black tracking-tight text-rose-800" data-testid="expense-slip-title">GİDER PUSULASI</div>
                <div className="font-mono font-bold text-sm mt-1" data-testid="expense-slip-number">{number}</div>
                <div className="text-slate-600 mt-0.5">Tarih: <b data-testid="expense-slip-date">{issueDate || "—"}</b></div>
                <div className="mt-1 inline-block px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-700">
                  {copy}. NÜSHA — {copy === 1 ? "Satıcıya / İşi yapana" : "Düzenleyende kalır"}
                </div>
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-3 mb-4 bg-slate-50/50" data-testid="expense-slip-seller-box">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Satan / İşi Yapan</div>
              <div className="font-bold text-sm" data-testid="expense-slip-seller-name">{sellerName}</div>
              {sellerAddress && <div className="text-slate-600 mt-0.5">{sellerAddress}</div>}
              {(sellerTaxOffice || sellerTaxId) && (
                <div className="text-slate-600 mt-0.5">
                  {sellerTaxOffice && <>VD: {sellerTaxOffice}</>}
                  {sellerTaxOffice && sellerTaxId && " · "}
                  {sellerTaxId && <>Vergi No / TCKN: {sellerTaxId}</>}
                </div>
              )}
              {seller?.phone && <div className="text-slate-500 mt-0.5">{seller.phone}</div>}
            </div>

            <table className="w-full border-collapse border border-slate-400 mb-4" data-testid="expense-slip-items">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-400 px-2 py-1.5 text-left w-8">No</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left">İşin Mahiyeti / Malın Cinsi</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right w-16">Miktar</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-left w-14">Birim</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right w-24">Birim Fiyat</th>
                  <th className="border border-slate-400 px-2 py-1.5 text-right w-24">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="border border-slate-400 px-2 py-4 text-center text-slate-400">Kalem yok</td>
                  </tr>
                )}
                {items.map((it, i) => {
                  const qty = Number(it.quantity ?? it.qty ?? 1);
                  const price = Number(it.unit_price ?? it.price ?? 0);
                  const line = Number(it.line_total ?? it.total ?? (qty * price));
                  const name = it.name || it.product_name || it.description || "—";
                  const note = it.note || it.notes || it.line_note || "";
                  return (
                    <tr key={i} data-testid={`expense-slip-item-${i}`}>
                      <td className="border border-slate-400 px-2 py-1.5 align-top tabular-nums">{i + 1}</td>
                      <td className="border border-slate-400 px-2 py-1.5 align-top">
                        <div className="font-semibold">{name}</div>
                        {note && <div className="text-[10px] text-slate-500 italic mt-0.5">{note}</div>}
                      </td>
                      <td className="border border-slate-400 px-2 py-1.5 text-right align-top tabular-nums">{fmt(qty)}</td>
                      <td className="border border-slate-400 px-2 py-1.5 align-top">{it.unit || "Adet"}</td>
                      <td className="border border-slate-400 px-2 py-1.5 text-right align-top tabular-nums">{fmt(price)}</td>
                      <td className="border border-slate-400 px-2 py-1.5 text-right align-top font-semibold tabular-nums">{fmt(line)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex justify-end mb-6">
              <div className="w-72 space-y-1 border border-slate-400 rounded-lg p-3" data-testid="expense-slip-totals">
                <div className="flex justify-between gap-4"><span>Mal / Hizmet Tutarı (Brüt)</span><span className="font-mono tabular-nums">{fmt(subtotal)} ₺</span></div>
                {vatTotal > 0 && <div className="flex justify-between gap-4"><span>KDV</span><span className="font-mono tabular-nums">{fmt(vatTotal)} ₺</span></div>}
                {whAmount > 0 && (
                  <div className="flex justify-between gap-4 text-indigo-800">
                    <span>Tevkifat {whLabel && `(${whLabel})`}</span>
                    <span className="font-mono tabular-nums">-{fmt(whAmount)} ₺</span>
                  </div>
                )}
                <div className="flex justify-between gap-4 border-t border-slate-400 pt-1.5 font-black text-sm">
                  <span>Net Ödenen</span>
                  <span className="font-mono tabular-nums" data-testid="expense-slip-net">{fmt(netPaid)} ₺</span>
                </div>
              </div>
            </div>

            {doc?.notes && (
              <p className="text-[10px] text-slate-500 mb-4 italic" data-testid="expense-slip-notes">{doc.notes}</p>
            )}

            <div className="grid grid-cols-2 gap-8 mt-8 pt-4">
              <div className="text-center">
                <div className="text-[10px] uppercase font-bold text-slate-500 mb-10">Satıcının / İşi Yapanın İmzası</div>
                <div className="border-t border-slate-400 mx-6 pt-1 text-slate-400 text-[10px]">Ad Soyad / İmza</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] uppercase font-bold text-slate-500 mb-10">Düzenleyenin Kaşe / İmzası</div>
                <div className="border-t border-slate-400 mx-6 pt-1 text-slate-400 text-[10px]">Kaşe / İmza</div>
              </div>
            </div>

            <p className="mt-6 text-[9px] text-slate-400 leading-snug">
              VUK md.234 / 225 Sıra No.lu Tebliğ: En az iki nüsha düzenlenir; 1. nüsha işi yapana veya malı satana verilir,
              2. nüsha düzenleyen tarafından saklanır. Mal teslimi veya hizmet tarihinden itibaren azami 7 gün içinde düzenlenmelidir.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ExpenseSlipPrint;
