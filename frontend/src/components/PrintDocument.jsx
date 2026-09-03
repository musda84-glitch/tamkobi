import React, { useEffect, useState } from "react";
import { X, Printer, Settings2 } from "lucide-react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const TITLES = { invoice: "FATURA", order: "SİPARİŞ FORMU", quote: "FİYAT TEKLİFİ", dispatch: "İRSALİYE" };

export const PrintDocument = ({ docType, doc, company, onClose, onEditTemplate }) => {
  const [tpl, setTpl] = useState(null);
  const [prodImgs, setProdImgs] = useState({});
  useEffect(() => { axios.get(`${API_URL}/products?company_id=${company?.id || "comp_nexus_main_01"}`).then((r) => { const m = {}; r.data.forEach((p) => { if (p.image_url) m[p.id] = p.image_url; }); setProdImgs(m); }).catch(() => {}); }, [company]);
  useEffect(() => { axios.get(`${API_URL}/companies/${company?.id || "comp_nexus_main_01"}/print-templates`).then((r) => setTpl(r.data[docType])).catch(() => setTpl({})); }, [docType, company]);
  if (!tpl) return null;
  const number = docType === "quote" ? doc.quote_number : docType === "order" ? doc.order_number : (doc.invoice_number || doc.quote_number || "");
  const customer = doc.contact_name || doc.customer_name || "";
  const items = doc.items || [];
  const total = doc.grand_total ?? doc.total_amount ?? 0;
  const color = tpl.primary_color || "#059669";
  const textSize = tpl.font_size === "xs" ? "text-[10px]" : tpl.font_size === "base" ? "text-sm" : "text-xs";
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/70 flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl print:shadow-none print:rounded-none" data-testid="print-document">
        <div className="flex items-center justify-between px-5 py-3 border-b no-print print:hidden">
          <span className="text-xs font-bold text-slate-700">Yazdırma Önizleme — {TITLES[docType]}</span>
          <div className="flex items-center gap-2">
            {onEditTemplate && <button onClick={onEditTemplate} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs font-semibold hover:bg-slate-50" data-testid="print-edit-template-btn"><Settings2 className="w-3.5 h-3.5" /> Form Düzenle</button>}
            <button onClick={() => window.print()} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="print-now-btn"><Printer className="w-3.5 h-3.5" /> Yazdır</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="print-close-btn"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className={`p-10 ${textSize} text-slate-800 print-area`} id="print-area">
          <div className="flex justify-between items-start border-b-4 pb-4" style={{ borderColor: color }}>
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
              <div className="text-2xl font-black tracking-tight" style={{ color }}>{tpl.title_override || TITLES[docType]}</div>
              <div className="font-mono font-semibold">{number}</div>
              <div className="text-slate-500">Tarih: {doc.issue_date || (doc.order_date || doc.created_at || "").slice(0, 10)}</div>
              {doc.valid_until && <div className="text-slate-500">Geçerlilik: {doc.valid_until}</div>}
              {doc.due_date && <div className="text-slate-500">Vade: {doc.due_date}</div>}
            </div>
          </div>
          {tpl.header_note && <p className="mt-3 text-slate-600 italic">{tpl.header_note}</p>}
          <div className="mt-5 grid grid-cols-2 gap-6">
            <div><div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Sayın</div><div className="font-bold text-base">{customer}</div>{(doc.shipping_address || doc.address) && <div className="text-slate-500">{doc.shipping_address || doc.address} {doc.city || ""}</div>}{doc.customer_phone && <div className="text-slate-500">{doc.customer_phone}</div>}</div>
            {doc.title && <div className="text-right"><div className="text-[10px] uppercase font-bold text-slate-400 mb-1">Konu</div><div className="font-semibold">{doc.title}</div></div>}
          </div>
          <table className="w-full mt-6 border-collapse">
            <thead><tr style={{ backgroundColor: color }} className="text-white">{tpl.show_images !== false && <th className="p-2 rounded-l w-12"></th>}<th className="text-left p-2">Açıklama</th><th className="text-right p-2">Miktar</th><th className="text-right p-2">Birim Fiyat</th><th className="text-right p-2">KDV</th><th className="text-right p-2 rounded-r">Tutar</th></tr></thead>
            <tbody>{items.map((it, i) => <tr key={i} className="border-b border-slate-100">{tpl.show_images !== false && <td className="p-1">{(it.image_url || prodImgs[it.product_id]) ? <img src={resolveImageUrl(it.image_url || prodImgs[it.product_id])} alt="" className="w-10 h-10 object-cover rounded border" /> : null}</td>}<td className="p-2">{it.name || it.product_name}{it.discount_rate > 0 && <span className="ml-1 text-[10px] text-rose-600">(%{it.discount_rate} isk.)</span>}</td><td className="p-2 text-right">{it.quantity} {it.unit || ""}</td><td className="p-2 text-right">{fmt(it.unit_price)} ₺</td><td className="p-2 text-right">%{it.vat_rate ?? 20}</td><td className="p-2 text-right font-semibold">{fmt(it.total)} ₺</td></tr>)}</tbody>
          </table>
          <div className="flex justify-end mt-4"><div className="w-64 space-y-1">
            {doc.subtotal !== undefined && <div className="flex justify-between"><span className="text-slate-500">Ara Toplam</span><span>{fmt(doc.subtotal)} ₺</span></div>}
            {doc.vat_total !== undefined && <div className="flex justify-between"><span className="text-slate-500">KDV</span><span>{fmt(doc.vat_total)} ₺</span></div>}
            <div className="flex justify-between text-base font-black border-t-2 pt-1" style={{ borderColor: color }}><span>GENEL TOPLAM</span><span style={{ color }}>{fmt(total)} ₺</span></div>
          </div></div>
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
  );
};

export const PrintTemplateEditor = ({ companyId, docType, onClose, onSaved }) => {
  const [tpl, setTpl] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/companies/${companyId}/print-templates`).then((r) => setTpl(r.data[docType])); }, [companyId, docType]);
  if (!tpl) return null;
  const set = (k, v) => setTpl({ ...tpl, [k]: v });
  const save = async () => { const r = await axios.put(`${API_URL}/companies/${companyId}/print-templates/${docType}`, tpl); onSaved?.(r.data); onClose(); };
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
          <div><label className="block font-semibold mb-1">Kağıt</label><select value={tpl.paper} onChange={(e) => set("paper", e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2"><option>A4</option><option>A5</option></select></div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">{[["show_logo", "Logo göster"], ["show_tax_info", "Vergi bilgileri"], ["show_bank_info", "Banka / IBAN"], ["show_signature", "Kaşe / İmza alanı"], ["show_barcode", "Barkod"], ["show_images", "Ürün resimleri"]].map(([k, l]) => <label key={k} className="flex items-center gap-2 bg-slate-50 border rounded-lg px-2 py-1.5 cursor-pointer"><input type="checkbox" checked={!!tpl[k]} onChange={(e) => set(k, e.target.checked)} data-testid={`tpl-${k}`} /><span className="font-semibold">{l}</span></label>)}</div>
        <div className="flex justify-end gap-2 pt-2 border-t"><button onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={save} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="tpl-save-btn">Kaydet</button></div>
      </div>
    </div>
  );
};
