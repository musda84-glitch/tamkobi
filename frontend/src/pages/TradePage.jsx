import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Globe, Plus, Ship, Plane, FileText, Trash2, RefreshCw, X, Calculator } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { SearchSelect } from "../components/SearchSelect";
import { fmtMoney } from "../utils/money";
import { statusTr } from "../utils/labels";

const emptyItem = () => ({ product_id: "", name: "", sku: "", gtip: "", origin_country: "", quantity: 1, unit: "Adet", unit_price_fx: 0 });
const emptyForm = (kind) => ({
  kind, contact_id: "", contact_name: "", country: "", customs_office: "", customs_broker: "",
  regime_code: kind === "import" ? "4000" : "1000", incoterm: kind === "import" ? "CIF" : "FOB",
  currency: "USD", fx_rate: 42.5, bl_awb: "", container_no: "", declaration_no: "", declaration_date: "",
  dab_no: "", certificate: "", freight: 0, insurance: 0, customs_duty_rate: 0, otv_rate: 0, kkdf_rate: 0,
  stamp_tax: 0, import_vat_rate: kind === "import" ? 20 : 0, notes: "", file_date: new Date().toISOString().slice(0, 10),
  items: [emptyItem()],
});

export default function TradePage() {
  const { activeCompany, can } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const canEdit = can("/dis-ticaret", "edit");
  const [kind, setKind] = useState("export");
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [f, m, c, p] = await Promise.all([
        axios.get(`${API_URL}/trade-files?company_id=${companyId}&kind=${kind}`),
        meta ? Promise.resolve({ data: meta }) : axios.get(`${API_URL}/trade-files/meta`),
        axios.get(`${API_URL}/contacts?company_id=${companyId}`),
        axios.get(`${API_URL}/products?company_id=${companyId}`),
      ]);
      setRows(f.data || []);
      if (!meta) setMeta(m.data);
      setContacts(c.data || []);
      setProducts(p.data || []);
    } catch { toast.error("Dış ticaret dosyaları yüklenemedi."); }
  }, [companyId, kind, meta]);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditing(null); setForm(emptyForm(kind)); };
  const openEdit = (r) => { setEditing(r); setForm({ ...emptyForm(r.kind), ...r, items: (r.items || []).length ? r.items : [emptyItem()] }); };
  const setF = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const setItem = (i, k, v) => setForm((s) => ({ ...s, items: s.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)) }));
  const pickProduct = (i, id) => {
    const p = products.find((x) => (x.id || x._id) === id);
    if (!p) return;
    setForm((s) => ({ ...s, items: s.items.map((it, idx) => (idx === i ? { ...it, product_id: id, name: p.name, sku: p.sku || "", gtip: p.gtip || it.gtip, origin_country: p.origin_country || it.origin_country, unit: p.unit || "Adet", unit_price_fx: Number(kind === "import" ? p.purchase_price : p.sale_price) || it.unit_price_fx } : it)) }));
  };

  const save = async () => {
    if (!canEdit) { toast.error("Düzenleme yetkiniz yok."); return; }
    if (!form.contact_id && !form.contact_name) { toast.error("Cari seçin."); return; }
    const items = (form.items || []).filter((it) => it.name && Number(it.quantity) > 0);
    if (!items.length) { toast.error("En az bir kalem ekleyin."); return; }
    setBusy(true);
    try {
      const payload = { ...form, company_id: companyId, items };
      if (editing) await axios.put(`${API_URL}/trade-files/${editing.id}`, payload);
      else await axios.post(`${API_URL}/trade-files`, payload);
      toast.success(editing ? "Dosya güncellendi." : "Dosya oluşturuldu.");
      setForm(null); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); }
    finally { setBusy(false); }
  };

  const convert = async (r) => {
    if (!window.confirm(`${r.file_number} dosyasından fatura oluşturulsun mu?`)) return;
    try {
      const res = await axios.post(`${API_URL}/trade-files/${r.id}/convert-to-invoice`, {});
      toast.success(res.data.message); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Fatura oluşturulamadı."); }
  };
  const remove = async (r) => {
    if (!window.confirm(`${r.file_number} çöp kutusuna alınsın mı?`)) return;
    try { await axios.delete(`${API_URL}/trade-files/${r.id}`); toast.success("Dosya silindi."); load(); }
    catch (e) { toast.error(e.response?.data?.detail || "Silinemedi."); }
  };

  const preview = useMemo(() => {
    if (!form) return null;
    const fx = Number(form.fx_rate) || 1;
    const goods = (form.items || []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price_fx) || 0), 0);
    const goodsTry = goods * fx;
    const cif = goodsTry + Number(form.freight || 0) + Number(form.insurance || 0);
    const duty = cif * Number(form.customs_duty_rate || 0) / 100;
    const otv = (cif + duty) * Number(form.otv_rate || 0) / 100;
    const kkdf = goodsTry * Number(form.kkdf_rate || 0) / 100;
    const vat = (cif + duty + otv) * Number(form.import_vat_rate || 0) / 100;
    const landed = cif + duty + otv + kkdf + Number(form.stamp_tax || 0) + vat;
    return { goods, goodsTry, cif, duty, otv, kkdf, vat, landed };
  }, [form]);

  const regimes = kind === "import" ? (meta?.regimes_import || []) : (meta?.regimes_export || []);

  return (
    <div className="space-y-5" data-testid="trade-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><Globe className="w-6 h-6 text-sky-600" /> İthalat / İhracat</h1>
          <p className="text-xs sm:text-sm text-slate-500">Logo / Mikro tarzı gümrük dosyası: GTIP, teslim şekli, kur, navlun, gümrük vergisi ve faturaya aktarım.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2.5 bg-white border rounded-xl" data-testid="trade-refresh"><RefreshCw className="w-4 h-4" /></button>
          {canEdit && <button onClick={openNew} className="flex items-center gap-2 px-4 py-2.5 bg-sky-600 text-white rounded-xl font-semibold" data-testid="trade-new"><Plus className="w-4 h-4" /> Yeni {kind === "import" ? "İthalat" : "İhracat"} Dosyası</button>}
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {[["export", "İhracat", Plane], ["import", "İthalat", Ship]].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setKind(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${kind === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid={`trade-tab-${k}`}>
            <Icon className="w-4 h-4" /> {l}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr>
            <th className="px-4 py-2 text-left">Dosya</th><th className="px-4 py-2 text-left">Cari / Ülke</th><th className="px-4 py-2 text-left">Teslim / Rejim</th>
            <th className="px-4 py-2 text-right">Döviz</th><th className="px-4 py-2 text-right">Maliyet (₺)</th><th className="px-4 py-2 text-left">Durum</th><th className="px-4 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400" data-testid="trade-empty">Henüz {kind === "import" ? "ithalat" : "ihracat"} dosyası yok.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50" data-testid={`trade-row-${r.file_number}`}>
                <td className="px-4 py-3"><div className="font-mono font-bold">{r.file_number}</div><div className="text-[11px] text-slate-400">{r.file_date}</div></td>
                <td className="px-4 py-3"><div className="font-semibold">{r.contact_name}</div><div className="text-[11px] text-slate-500">{r.country || "—"} · {r.incoterm}</div></td>
                <td className="px-4 py-3 text-xs text-slate-600">{r.regime_code} · {r.customs_office || "Gümrük —"}{r.declaration_no ? ` · Bey. ${r.declaration_no}` : ""}</td>
                <td className="px-4 py-3 text-right font-semibold">{fmtMoney(r.amount_fx, r.currency)}</td>
                <td className="px-4 py-3 text-right font-bold">{fmtMoney(r.landed_cost || r.amount_try, "TRY")}</td>
                <td className="px-4 py-3"><span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 font-semibold">{statusTr(r.status)}</span>{r.invoice_number && <div className="text-[10px] text-emerald-700 font-mono mt-0.5">{r.invoice_number}</div>}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(r)} className="px-2 py-1 text-xs font-semibold border rounded-lg mr-1" data-testid={`trade-edit-${r.file_number}`}>Aç</button>
                  {canEdit && !r.invoice_id && <button onClick={() => convert(r)} className="px-2 py-1 text-xs font-semibold bg-emerald-600 text-white rounded-lg mr-1" data-testid={`trade-invoice-${r.file_number}`}><FileText className="w-3 h-3 inline mr-1" />Fatura</button>}
                  {canEdit && !r.invoice_id && <button onClick={() => remove(r)} className="p-1 text-rose-500" data-testid={`trade-del-${r.file_number}`}><Trash2 className="w-4 h-4" /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setForm(null)}>
          <div className="bg-white rounded-2xl w-full max-w-5xl my-6 p-5 space-y-4 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="trade-modal">
            <div className="flex justify-between items-center border-b pb-2">
              <h3 className="text-base font-bold">{editing ? `${editing.file_number} düzenle` : `Yeni ${form.kind === "import" ? "ithalat" : "ihracat"} dosyası`}</h3>
              <button onClick={() => setForm(null)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2"><label className="font-semibold block mb-1">Cari</label><SearchSelect value={form.contact_id} options={contacts} getLabel={(c) => c.name} getSub={(c) => c.tax_number_or_id} placeholder="Cari ara…" onChange={(id, c) => setForm((s) => ({ ...s, contact_id: id, contact_name: c?.name || s.contact_name }))} testId="trade-contact" /></div>
              <div><label className="font-semibold block mb-1">{form.kind === "import" ? "Menşe ülke" : "Varış ülke"}</label><input value={form.country} onChange={(e) => setF("country", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="trade-country" /></div>
              <div><label className="font-semibold block mb-1">Teslim şekli</label><select value={form.incoterm} onChange={(e) => setF("incoterm", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="trade-incoterm">{(meta?.incoterms || []).map((x) => <option key={x}>{x}</option>)}</select></div>
              <div><label className="font-semibold block mb-1">Rejim</label><select value={form.regime_code} onChange={(e) => setF("regime_code", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="trade-regime">{regimes.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></div>
              <div><label className="font-semibold block mb-1">Gümrük idaresi</label><input value={form.customs_office} onChange={(e) => setF("customs_office", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" placeholder="Ambarlı, Erenköy…" data-testid="trade-customs" /></div>
              <div><label className="font-semibold block mb-1">Gümrük müşaviri</label><input value={form.customs_broker} onChange={(e) => setF("customs_broker", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" /></div>
              <div><label className="font-semibold block mb-1">Döviz</label><select value={form.currency} onChange={(e) => { const c = e.target.value; setForm((s) => ({ ...s, currency: c, fx_rate: meta?.fx_defaults?.[c] || s.fx_rate })); }} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="trade-currency">{(meta?.currencies || ["USD"]).map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label className="font-semibold block mb-1">Kur (₺)</label><input type="number" step="0.0001" value={form.fx_rate} onChange={(e) => setF("fx_rate", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="trade-fx" /></div>
              <div><label className="font-semibold block mb-1">Konşimento / AWB</label><input value={form.bl_awb} onChange={(e) => setF("bl_awb", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="trade-bl" /></div>
              <div><label className="font-semibold block mb-1">Konteyner no</label><input value={form.container_no} onChange={(e) => setF("container_no", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" /></div>
              <div><label className="font-semibold block mb-1">Beyanname no</label><input value={form.declaration_no} onChange={(e) => setF("declaration_no", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="trade-declaration" /></div>
              <div><label className="font-semibold block mb-1">Beyanname tarihi</label><input type="date" value={form.declaration_date} onChange={(e) => setF("declaration_date", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" /></div>
              {form.kind === "export" && <div><label className="font-semibold block mb-1">DAB no</label><input value={form.dab_no} onChange={(e) => setF("dab_no", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50" data-testid="trade-dab" /></div>}
              <div><label className="font-semibold block mb-1">Menşe belgesi</label><select value={form.certificate} onChange={(e) => setF("certificate", e.target.value)} className="w-full border rounded-lg p-2 bg-slate-50">{(meta?.certificates || []).map((c) => <option key={c || "yok"} value={c}>{c || "Yok"}</option>)}</select></div>
            </div>

            {form.kind === "import" && (
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3" data-testid="trade-import-costs">
                <div><label className="font-semibold block mb-1">Navlun ₺</label><input type="number" value={form.freight} onChange={(e) => setF("freight", e.target.value)} className="w-full border rounded-lg p-2" data-testid="trade-freight" /></div>
                <div><label className="font-semibold block mb-1">Sigorta ₺</label><input type="number" value={form.insurance} onChange={(e) => setF("insurance", e.target.value)} className="w-full border rounded-lg p-2" /></div>
                <div><label className="font-semibold block mb-1">GV %</label><input type="number" value={form.customs_duty_rate} onChange={(e) => setF("customs_duty_rate", e.target.value)} className="w-full border rounded-lg p-2" data-testid="trade-duty" /></div>
                <div><label className="font-semibold block mb-1">ÖTV %</label><input type="number" value={form.otv_rate} onChange={(e) => setF("otv_rate", e.target.value)} className="w-full border rounded-lg p-2" /></div>
                <div><label className="font-semibold block mb-1">KKDF %</label><input type="number" value={form.kkdf_rate} onChange={(e) => setF("kkdf_rate", e.target.value)} className="w-full border rounded-lg p-2" /></div>
                <div><label className="font-semibold block mb-1">İth. KDV %</label><input type="number" value={form.import_vat_rate} onChange={(e) => setF("import_vat_rate", e.target.value)} className="w-full border rounded-lg p-2" /></div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between font-bold"><span>Kalemler (GTIP)</span><button type="button" onClick={() => setForm((s) => ({ ...s, items: [...s.items, emptyItem()] }))} className="text-sky-700" data-testid="trade-add-item">+ Kalem</button></div>
              {form.items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center" data-testid={`trade-item-${i}`}>
                  <div className="col-span-4"><SearchSelect value={it.product_id} options={products} getLabel={(p) => p.name} getSub={(p) => `${p.sku || ""} ${p.gtip ? "GTIP " + p.gtip : ""}`} placeholder="Ürün" onChange={(id) => pickProduct(i, id)} testId={`trade-item-prod-${i}`} /></div>
                  <input value={it.gtip} onChange={(e) => setItem(i, "gtip", e.target.value)} placeholder="GTIP" className="col-span-2 border rounded-lg p-2 font-mono" data-testid={`trade-item-gtip-${i}`} />
                  <input type="number" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} className="col-span-1 border rounded-lg p-2 text-center" />
                  <input type="number" step="0.01" value={it.unit_price_fx} onChange={(e) => setItem(i, "unit_price_fx", e.target.value)} className="col-span-2 border rounded-lg p-2 text-right" data-testid={`trade-item-price-${i}`} />
                  <div className="col-span-2 text-right font-semibold">{fmtMoney((Number(it.quantity) || 0) * (Number(it.unit_price_fx) || 0), form.currency)}</div>
                  <button type="button" onClick={() => setForm((s) => ({ ...s, items: s.items.filter((_, k) => k !== i) }))} className="col-span-1 text-rose-500"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>

            {preview && (
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 bg-slate-50 rounded-xl p-3 font-semibold" data-testid="trade-cost-preview">
                <span>Mal: {fmtMoney(preview.goods, form.currency)}</span>
                <span>Mal ₺: {fmtMoney(preview.goodsTry, "TRY")}</span>
                {form.kind === "import" && <><span>CIF: {fmtMoney(preview.cif, "TRY")}</span><span>GV: {fmtMoney(preview.duty, "TRY")}</span><span>KDV: {fmtMoney(preview.vat, "TRY")}</span></>}
                <span className="text-sky-800 flex items-center gap-1"><Calculator className="w-3.5 h-3.5" /> Maliyet: {fmtMoney(preview.landed, "TRY")}</span>
              </div>
            )}
            <textarea value={form.notes} onChange={(e) => setF("notes", e.target.value)} rows={2} placeholder="Not" className="w-full border rounded-lg p-2" />
            <div className="flex justify-end gap-2"><button onClick={() => setForm(null)} className="px-4 py-2 border rounded-lg">İptal</button><button onClick={save} disabled={busy || !canEdit} className="px-5 py-2 bg-sky-600 text-white rounded-lg font-bold disabled:opacity-50" data-testid="trade-save">{busy ? "Kaydediliyor…" : "Kaydet"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
