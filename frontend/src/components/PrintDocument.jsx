import React, { useEffect, useState } from "react";
import { X, Printer, Settings2, LayoutTemplate } from "lucide-react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";
import { resolveImageUrl } from "../utils/imageUrl";
import { Barcode } from "./BarcodeLabelPrint";
import { moneySuffix } from "../utils/money";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const TITLES = { invoice: "FATURA", order: "SİPARİŞ FORMU", quote: "FİYAT TEKLİFİ", dispatch: "İRSALİYE" };
const docTitle = (docType, doc) => {
  if (doc.e_type === "e_export" || doc.trade_kind === "export") return "e-İHRACAT FATURASI";
  if (doc.trade_kind === "import") return "İTHALAT FATURASI";
  return TITLES[docType];
};

export const LAYOUTS = [
  ["classic", "Klasik", "Alt çizgili başlık, renkli tablo başlığı"],
  ["modern", "Modern", "Renkli üst bant, yuvarlatılmış tablo"],
  ["minimal", "Sade", "Siyah-beyaz, ince çizgiler"],
  ["bold", "Vurgulu", "Sol renk şeridi, zebra tablo"]
];

const findLineProduct = (it, productsById) => {
  if (it.product_id && productsById[it.product_id]) return productsById[it.product_id];
  const sku = String(it.sku || "").trim();
  const barcode = String(it.barcode || "").trim();
  return Object.values(productsById).find((p) =>
    (sku && p.sku === sku) || (barcode && p.barcode === barcode) ||
    (p.variants || []).some((v) => (sku && (v.sku === sku || v.barcode === sku)) || (barcode && (v.barcode === barcode || v.sku === barcode)))
  ) || null;
};

const lineStockCode = (it, productsById) => {
  const p = findLineProduct(it, productsById);
  const variants = p?.variants || [];
  const sku = String(it.sku || "").trim();
  const barcode = String(it.barcode || "").trim();
  const name = String(it.name || it.product_name || "");
  const v = variants.find((x) =>
    (sku && (x.sku === sku || x.barcode === sku)) ||
    (barcode && (x.barcode === barcode || x.sku === barcode)) ||
    (x.sku && name.includes(x.sku))
  );
  return String(v?.barcode || barcode || p?.barcode || v?.sku || sku || p?.sku || "").trim();
};

const LineStockBarcode = ({ item, productsById, index }) => {
  const code = lineStockCode(item, productsById);
  if (!code) return null;
  return (
    <div className="inline-flex items-center shrink-0" data-testid={`print-item-barcode-${index}`}>
      <Barcode value={code} height={16} width={0.8} fontSize={7} />
    </div>
  );
};

export const PrintDocument = ({ docType, doc, company, onClose, onEditTemplate }) => {
  const [tpl, setTpl] = useState(null);
  const [productsById, setProductsById] = useState({});
  const [plan, setPlan] = useState(doc.payment_plan?.rows || null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const companyId = company?.id || "comp_nexus_main_01";
  useEffect(() => { axios.get(`${API_URL}/products?company_id=${companyId}`).then((r) => { const m = {}; (r.data || []).forEach((p) => { const id = p.id || p._id; if (id) m[id] = p; }); setProductsById(m); }).catch(() => {}); }, [companyId]);
  useEffect(() => { const f = () => axios.get(`${API_URL}/companies/${companyId}/print-templates`).then((r) => setTpl(r.data[docType])).catch(() => setTpl({})); f(); window.addEventListener("print-template-saved", f); return () => window.removeEventListener("print-template-saved", f); }, [docType, companyId]);
  useEffect(() => { if (docType === "invoice" && doc.installment_plan && doc.id) axios.get(`${API_URL}/invoices/${doc.id}/installments`).then((r) => setPlan(r.data)).catch(() => {}); }, [docType, doc.installment_plan, doc.id]);
  if (!tpl) return null;
  const layout = tpl.layout || "classic";
  const pickLayout = async (l) => { const next = { ...tpl, layout: l }; setTpl(next); try { await axios.put(`${API_URL}/companies/${companyId}/print-templates/${docType}`, next); } catch { /* keep local */ } };
  const number = docType === "quote" ? doc.quote_number : docType === "order" ? doc.order_number : (doc.invoice_number || doc.quote_number || "");
  const customer = doc.contact_name || doc.customer_name || "";
  const items = doc.items || [];
  const total = doc.grand_total ?? doc.total_amount ?? 0;
  const color = layout === "minimal" ? "#0f172a" : (tpl.primary_color || "#059669");
  const textSize = tpl.font_size === "xs" ? "text-[10px]" : tpl.font_size === "base" ? "text-sm" : "text-xs";
  const isModern = layout === "modern", isMinimal = layout === "minimal", isBold = layout === "bold";
  const thStyle = isMinimal ? { borderBottom: "2px solid #0f172a" } : isBold ? { backgroundColor: "#0f172a" } : { backgroundColor: color };
  const thCls = isMinimal ? "text-slate-900" : "text-white";
  const hideAll = !!tpl.hide_all_prices, hideLine = hideAll || !!tpl.hide_line_prices, hideVat = hideAll || !!tpl.hide_vat;
  const suf = moneySuffix(doc.currency);
  const fmtM = (n) => `${fmt(n)} ${suf}`;
  const title = tpl.title_override || docTitle(docType, doc);
  const itemNote = (it) => it.note || it.notes || it.description || it.line_note || "";
  const orderNotes = [doc.customer_note, doc.order_note, doc.customer_notes].filter(Boolean);
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/70 flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl print:shadow-none print:rounded-none" data-testid="print-document">
        <div className="flex items-center justify-between px-5 py-3 border-b no-print print:hidden">
          <span className="text-xs font-bold text-slate-700">Yazdırma Önizleme — {TITLES[docType]}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPickerOpen(!pickerOpen)} className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-slate-50 ${pickerOpen ? "bg-slate-100" : ""}`} data-testid="print-layout-toggle-btn"><LayoutTemplate className="w-3.5 h-3.5" /> Şablon: {LAYOUTS.find((l) => l[0] === layout)?.[1]}</button>
            {onEditTemplate && <button onClick={onEditTemplate} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-slate-50" data-testid="print-edit-template-btn"><Settings2 className="w-3.5 h-3.5" /> Form Düzenle</button>}
            <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="print-now-btn"><Printer className="w-3.5 h-3.5" /> Yazdır</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="print-close-btn"><X className="w-5 h-5" /></button>
          </div>
        </div>
        {pickerOpen && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-5 py-3 bg-slate-50 border-b no-print print:hidden" data-testid="print-layout-picker">
            {LAYOUTS.map(([k, l, d]) => (
              <button key={k} onClick={() => pickLayout(k)} className={`text-left rounded-xl border-2 p-2 bg-white transition ${layout === k ? "border-emerald-600 shadow-md" : "border-slate-200 hover:border-slate-400"}`} data-testid={`print-layout-${k}`}>
                <div className="h-14 rounded-md overflow-hidden border border-slate-100 mb-1.5 relative bg-white">
                  {k === "classic" && <><div className="absolute top-2 left-2 right-2 h-1.5 rounded" style={{ backgroundColor: tpl.primary_color }} /><div className="absolute top-6 left-2 right-2 h-1 bg-slate-200" /><div className="absolute top-9 left-2 right-2 h-1 bg-slate-100" /></>}
                  {k === "modern" && <><div className="absolute top-0 left-0 right-0 h-5" style={{ backgroundColor: tpl.primary_color }} /><div className="absolute top-7 left-2 right-2 h-1.5 rounded-full" style={{ backgroundColor: tpl.primary_color, opacity: 0.5 }} /><div className="absolute top-10 left-2 right-2 h-1 bg-slate-100" /></>}
                  {k === "minimal" && <><div className="absolute top-2 left-2 right-2 h-px bg-slate-900" /><div className="absolute top-6 left-2 right-2 h-px bg-slate-900" /><div className="absolute top-9 left-2 right-2 h-px bg-slate-300" /></>}
                  {k === "bold" && <><div className="absolute top-0 bottom-0 left-0 w-2" style={{ backgroundColor: tpl.primary_color }} /><div className="absolute top-2 left-4 right-2 h-2 bg-slate-900 rounded-sm" /><div className="absolute top-6 left-4 right-2 h-1 bg-slate-100" /><div className="absolute top-8 left-4 right-2 h-1 bg-slate-200" /></>}
                </div>
                <div className="text-xs font-bold text-slate-900">{l}</div><div className="text-[10px] text-slate-500 leading-tight">{d}</div>
              </button>
            ))}
          </div>
        )}
        <div className={`${textSize} text-slate-800 print-area flex`} id="print-area">
          {isBold && <div className="w-3 shrink-0 self-stretch" style={{ backgroundColor: color }} />}
          <div className={`flex-1 ${isModern ? "" : "p-10"}`}>
          {isModern ? (
            <div className="px-10 py-6 text-white flex justify-between items-start" style={{ backgroundColor: color }}>
              <div className="flex items-center gap-3">
                {tpl.show_logo && company?.logo_url && <img src={resolveImageUrl(company.logo_url)} alt="logo" className="h-14 object-contain bg-white rounded-lg p-1" />}
                <div><div className="text-lg font-bold">{company?.name}</div><div className="opacity-80">{company?.address} {company?.city}</div>{tpl.show_tax_info && <div className="opacity-80">VD: {company?.tax_office} • VKN: {company?.tax_number}</div>}<div className="opacity-80">{company?.phone} • {company?.email}</div></div>
              </div>
              <div className="text-right"><div className="text-2xl font-black tracking-tight">{title}</div><div className="font-mono font-semibold">{number}</div><div className="opacity-80">Tarih: {doc.issue_date || (doc.order_date || doc.created_at || "").slice(0, 10)}</div>{doc.valid_until && <div className="opacity-80">Geçerlilik: {doc.valid_until}</div>}{doc.due_date && <div className="opacity-80">Vade: {doc.due_date}</div>}</div>
            </div>
          ) : (
          <div className={`flex justify-between items-start pb-4 ${isMinimal ? "border-b border-slate-900" : "border-b-4"}`} style={isMinimal ? {} : { borderColor: color }}>
            <div className="flex items-center gap-3">
              {tpl.show_logo && company?.logo_url && <img src={resolveImageUrl(company.logo_url)} alt="logo" className="h-14 object-contain" />}
              <div>
                <div className="text-lg font-bold" style={{ color }}>{company?.name}</div>
                <div className="text-slate-500">{company?.address} {company?.city}</div>
                {tpl.show_tax_info && <div className="text-slate-500">VD: {company?.tax_office} • VKN: {company?.tax_number}</div>}
                <div className="text-slate-500">{company?.phone} • {company?.email}</div>
              </div>
            </div>
            <div className="text-right">
              <div className={`${isBold ? "text-3xl" : "text-2xl"} font-black tracking-tight`} style={{ color: isBold ? "#0f172a" : color }}>{title}</div>
              <div className="font-mono font-semibold">{number}</div>
              <div className="text-slate-500">Tarih: {doc.issue_date || (doc.order_date || doc.created_at || "").slice(0, 10)}</div>
              {doc.valid_until && <div className="text-slate-500">Geçerlilik: {doc.valid_until}</div>}
              {doc.due_date && <div className="text-slate-500">Vade: {doc.due_date}</div>}
            </div>
          </div>
          )}
          <div className={isModern ? "px-10 pb-10" : ""}>
          {tpl.header_note && <p className="mt-3 text-slate-600 italic">{tpl.header_note}</p>}
          <div className="mt-5 grid grid-cols-2 gap-6">
            <div><div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Sayın</div><div className="font-bold text-base">{customer}</div>{(doc.shipping_address || doc.address) && <div className="text-slate-500">{doc.shipping_address || doc.address} {doc.city || ""}</div>}{doc.customer_phone && <div className="text-slate-500">{doc.customer_phone}</div>}{(doc.incoterm || doc.country) && <div className="text-slate-500 mt-1" data-testid="print-trade-meta">{[doc.incoterm, doc.country, doc.customs_office].filter(Boolean).join(" · ")}</div>}</div>
            {doc.title && <div className="text-right"><div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Konu</div><div className="font-semibold">{doc.title}</div></div>}
          </div>
          <table className={`w-full mt-6 border-collapse ${isModern ? "rounded-xl overflow-hidden" : ""}`}>
            <thead><tr style={thStyle} className={thCls}>{tpl.show_images !== false && <th className={`p-2 w-12 ${isModern ? "rounded-l-xl" : isMinimal ? "" : "rounded-l"}`}></th>}<th className="text-left p-2">Açıklama</th><th className={`text-right p-2 ${hideLine ? (isModern ? "rounded-r-xl" : isMinimal ? "" : "rounded-r") : ""}`}>Miktar</th>{!hideLine && <th className="text-right p-2">Birim Fiyat</th>}{!hideLine && !hideVat && <th className="text-right p-2">KDV</th>}{!hideLine && <th className={`text-right p-2 ${isModern ? "rounded-r-xl" : isMinimal ? "" : "rounded-r"}`}>Tutar</th>}</tr></thead>
            <tbody>{items.map((it, i) => (
              <tr key={i} className={`border-b border-slate-100 ${isBold && i % 2 ? "bg-slate-50" : ""}`}>
                {tpl.show_images !== false && <td className="p-1">{(it.image_url || productsById[it.product_id]?.image_url) ? <img src={resolveImageUrl(it.image_url || productsById[it.product_id]?.image_url)} alt="" className="w-8 h-8 object-cover rounded border" /> : null}</td>}
                <td className="p-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="min-w-0 flex-1">
                      {it.name || it.product_name}
                      {!hideLine && it.discount_rate > 0 && <span className="ml-1 text-[10px] text-rose-600">(%{it.discount_rate} isk.)</span>}
                      {it.gtip && <div className="text-[10px] font-mono text-slate-400">GTIP {it.gtip}{it.origin_country ? ` · ${it.origin_country}` : ""}</div>}
                      {tpl.show_item_notes !== false && itemNote(it) && <div className="mt-1 text-[10px] text-slate-600 italic whitespace-pre-wrap border-l-2 border-slate-200 pl-1.5" data-testid={`print-item-note-${i}`}>{itemNote(it)}</div>}
                    </div>
                    {tpl.show_barcode && <LineStockBarcode item={it} productsById={productsById} index={i} />}
                  </div>
                </td>
                <td className="p-2 text-right">{it.quantity} {it.unit || ""}</td>
                {!hideLine && <td className="p-2 text-right">{fmtM(it.unit_price)}</td>}
                {!hideLine && !hideVat && <td className="p-2 text-right">%{it.vat_rate ?? 20}</td>}
                {!hideLine && <td className="p-2 text-right font-semibold">{fmtM(it.total)}</td>}
              </tr>
            ))}</tbody>
          </table>
          {tpl.show_order_notes !== false && orderNotes.length > 0 && <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2 text-slate-700 whitespace-pre-wrap" data-testid="print-order-notes"><b>Sipariş Notu:</b> {orderNotes.join(" • ")}</div>}
          {!hideAll && <div className="flex justify-end mt-4"><div className={`w-64 space-y-1 ${isModern ? "rounded-xl p-3" : ""}`} style={isModern ? { backgroundColor: `${color}14` } : {}}>
            {doc.discount_total > 0 && <div className="flex justify-between text-rose-600"><span>İskonto</span><span>-{fmtM(doc.discount_total)}</span></div>}
            {!hideVat && doc.subtotal !== undefined && <div className="flex justify-between"><span className="text-slate-500">Ara Toplam</span><span>{fmtM(doc.subtotal)}</span></div>}
            {!hideVat && doc.vat_total !== undefined && <div className="flex justify-between"><span className="text-slate-500">KDV</span><span>{fmtM(doc.vat_total)}</span></div>}
            {doc.withholding_amount > 0 && <div className="flex justify-between text-indigo-700"><span>Tevkifat</span><span>-{fmtM(doc.withholding_amount)}</span></div>}
            <div className="flex justify-between text-base font-black border-t-2 pt-1" style={{ borderColor: color }}><span>{hideVat ? "TOPLAM" : "GENEL TOPLAM"}</span><span style={{ color }}>{fmtM(total)}</span></div>
          </div></div>}
          {plan?.length > 0 && (
            <div className="mt-6" data-testid="print-payment-plan">
              <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Ödeme Planı ({plan.length} taksit)</div>
              <table className="w-full border-collapse"><tbody>{plan.map((r) => <tr key={r.no} className="border-b border-slate-100"><td className="py-1 font-semibold">{r.label}</td><td className="py-1 text-slate-500 font-mono">{r.due_date}</td><td className="py-1 text-right font-semibold">{fmt(r.amount)} ₺</td><td className="py-1 text-right w-20">{r.status === "paid" ? <span className="text-emerald-700 font-bold">Ödendi</span> : r.status ? <span className="text-slate-400">Bekliyor</span> : null}</td></tr>)}</tbody></table>
            </div>
          )}
          {(doc.notes || doc.terms) && <div className="mt-6 text-slate-600 whitespace-pre-wrap">{doc.notes}{doc.terms && <div className="mt-2"><b>Şartlar:</b> {doc.terms}</div>}</div>}
          {doc.images?.length > 0 && <div className="mt-6 grid grid-cols-4 gap-2">{doc.images.slice(0, 8).map((img) => <img key={img} src={resolveImageUrl(img)} alt="" className="w-full h-24 object-cover rounded-lg border" />)}</div>}
          {tpl.show_bank_info && company?.iban && <div className="mt-6 text-slate-600"><b>Banka:</b> {company.bank_name} • <b>IBAN:</b> <span className="font-mono">{company.iban}</span></div>}
          <div className="mt-10 flex justify-between items-end">
            <div className="text-slate-400 italic">{tpl.footer_note}</div>
            {tpl.show_signature && <div className="text-center"><div className="w-40 border-b border-slate-300 mb-1"></div><div className="text-slate-500">Kaşe / İmza</div></div>}
          </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PrintTemplateEditor = ({ companyId, docType, onClose, onSaved }) => {
  const [tpl, setTpl] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/companies/${companyId}/print-templates`).then((r) => setTpl(r.data[docType])); }, [companyId, docType]);
  if (!tpl) return null;
  const set = (k, v) => setTpl({ ...tpl, [k]: v });
  const save = async () => { const r = await axios.put(`${API_URL}/companies/${companyId}/print-templates/${docType}`, tpl); window.dispatchEvent(new Event("print-template-saved")); onSaved?.(r.data); onClose(); };
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3 text-xs shadow-2xl" data-testid="print-template-editor">
        <div className="flex justify-between border-b pb-2"><h3 className="text-sm font-bold">Form Düzenle — {TITLES[docType]}</h3><button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="block font-semibold mb-1">Başlık (boş = varsayılan)</label><input value={tpl.title_override} onChange={(e) => set("title_override", e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="tpl-title-input" /></div>
          <div><label className="block font-semibold mb-1">Ana Renk</label><input type="color" value={tpl.primary_color} onChange={(e) => set("primary_color", e.target.value)} className="w-full h-9 bg-slate-50 border rounded-lg" data-testid="tpl-color-input" /></div>
        </div>
        <div><label className="block font-semibold mb-1">Üst Not</label><input value={tpl.header_note} onChange={(e) => set("header_note", e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2" /></div>
        <div><label className="block font-semibold mb-1">Alt Not</label><textarea value={tpl.footer_note} onChange={(e) => set("footer_note", e.target.value)} rows={2} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="tpl-footer-input" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="block font-semibold mb-1">Yazı Boyutu</label><select value={tpl.font_size} onChange={(e) => set("font_size", e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2"><option value="xs">Küçük</option><option value="sm">Normal</option><option value="base">Büyük</option></select></div>
          <div><label className="block font-semibold mb-1">Şablon</label><select value={tpl.layout || "classic"} onChange={(e) => set("layout", e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="tpl-layout-select">{LAYOUTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="block font-semibold mb-1">Kağıt</label><select value={tpl.paper} onChange={(e) => set("paper", e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2"><option>A4</option><option>A5</option></select></div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">{[["show_logo", "Logo göster"], ["show_tax_info", "Vergi bilgileri"], ["show_bank_info", "Banka / IBAN"], ["show_signature", "Kaşe / İmza alanı"], ["show_barcode", "Stok barkodu"], ["show_images", "Ürün resimleri"]].map(([k, l]) => <label key={k} className="flex items-center gap-2 bg-slate-50 border rounded-lg px-2 py-1.5 cursor-pointer"><input type="checkbox" checked={!!tpl[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`tpl-${k}`} /><span className="font-semibold">{l}</span></label>)}</div>
        <div><div className="font-semibold mb-1 text-slate-500 uppercase text-[10px]">Fiyat & Not Görünümü</div><div className="grid grid-cols-2 gap-1.5">{[["hide_line_prices", "Satır fiyatlarını gizle", false], ["hide_vat", "KDV'yi gizle", false], ["hide_all_prices", "Tüm fiyatları gizle (sevk/çeki listesi)", false], ["show_item_notes", "Ürün açıklaması altında satır notu", true], ["show_order_notes", "Sipariş notlarını göster", true]].map(([k, l, def]) => <label key={k} className="flex items-center gap-2 bg-slate-50 border rounded-lg px-2 py-1.5 cursor-pointer"><input type="checkbox" checked={tpl[k] === undefined ? def : !!tpl[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`tpl-${k}`} /><span className="font-semibold">{l}</span></label>)}</div></div>
        <div className="flex justify-end gap-2 pt-2 border-t"><button onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={save} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="tpl-save-btn">Kaydet</button></div>
      </div>
    </div>
  );
};
