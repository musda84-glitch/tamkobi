import React, { useEffect, useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Plus, Trash2, BookOpen, ListOrdered } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { SearchSelect } from "./SearchSelect";
import { formatTrAmount } from "../utils/money";
import { normalizeWorkParks, normalizeWorkshopZones, stationNamesFromParks, zoneNamesFromList } from "../utils/workParks";

const fmt = (n) => formatTrAmount((n || 0));

/** Birim maliyet net (KDV hariç) — reçete toplamı için. */
export const materialUnitNet = (m) => {
  const cost = Number(m?.cost_per_unit || 0);
  if (!m?.cost_includes_vat) return cost;
  const rate = Number(m?.vat_rate || 0);
  if (rate <= 0) return cost;
  return cost / (1 + rate / 100);
};

export const materialLineCost = (m) =>
  materialUnitNet(m) * Number(m?.quantity || 0) * (1 + Number(m?.wastage_percent || 0) / 100);

const emptyMat = () => ({
  product_id: "",
  product_name: "",
  quantity: 1,
  unit: "Adet",
  cost_per_unit: 0,
  wastage_percent: 0,
  cost_includes_vat: false,
  vat_rate: 20,
});

export const RecipeModal = ({ companyId, products, recipe, presetProductId, onClose, onSaved }) => {
  useEscape(onClose);
  const finished = products.filter((p) => p.type !== "raw_material" && p.type !== "service");
  const materialsSrc = products.filter((p) => p.type !== "service");
  const [contacts, setContacts] = useState([]);
  const [stations, setStations] = useState([]);
  const [zones, setZones] = useState([]);
  const [f, setF] = useState({
    name: recipe?.name || "",
    finished_product_id: recipe?.finished_product_id || presetProductId || "",
    target_quantity: recipe?.target_quantity || 1,
    unit: recipe?.unit || "Adet",
    labor_cost: recipe?.labor_cost || 0,
    overhead_cost: recipe?.overhead_cost || 0,
    notes: recipe?.notes || "",
    contact_id: recipe?.contact_id || "",
    contact_name: recipe?.contact_name || "",
    job_file_name: recipe?.job_file_name || "",
  });
  const [steps, setSteps] = useState(recipe?.steps?.length ? recipe.steps.map((x) => ({ ...x })) : []);
  const updStep = (i, patch) => setSteps(steps.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const [mats, setMats] = useState(
    recipe?.materials?.length
      ? recipe.materials.map((m) => ({
          ...emptyMat(),
          ...m,
          cost_includes_vat: !!m.cost_includes_vat,
          vat_rate: Number(m.vat_rate ?? 20),
        }))
      : [emptyMat()]
  );
  const upd = (i, patch) => setMats(mats.map((m, idx) => idx === i ? { ...m, ...patch } : m));
  const pickMat = (i, id) => {
    const p = products.find((x) => x.id === id);
    upd(i, {
      product_id: id,
      product_name: p?.name || "",
      unit: p?.unit || "Adet",
      cost_per_unit: p?.purchase_price || 0,
      vat_rate: Number(p?.purchase_vat_rate ?? p?.vat_rate ?? 20),
    });
  };
  const matCost = mats.reduce((s, m) => s + materialLineCost(m), 0);
  const total = matCost + Number(f.labor_cost || 0) + Number(f.overhead_cost || 0);
  const unitCost = total / Number(f.target_quantity || 1);
  const fp = products.find((p) => p.id === f.finished_product_id);

  useEffect(() => {
    if (!companyId) return;
    axios.get(`${API_URL}/contacts`, { params: { company_id: companyId, lite: 1 } })
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : (r.data?.contacts || []);
        setContacts(rows.map((c) => ({ ...c, id: c.id || c._id })));
      })
      .catch(() => setContacts([]));
    axios.get(`${API_URL}/companies/${companyId}/work-parks`)
      .then((r) => setStations(stationNamesFromParks(normalizeWorkParks(r.data?.parks))))
      .catch(() => setStations([]));
    axios.get(`${API_URL}/companies/${companyId}/workshop-zones`)
      .then((r) => setZones(zoneNamesFromList(normalizeWorkshopZones(r.data?.zones))))
      .catch(() => setZones([]));
  }, [companyId]);

  const pickContact = (id, c) => {
    const row = c || contacts.find((x) => (x.id || x._id) === id);
    setF({
      ...f,
      contact_id: id || "",
      contact_name: row?.name || "",
    });
  };

  const save = async () => {
    const valid = mats.filter((m) => m.product_id && Number(m.quantity) > 0);
    if (!f.finished_product_id) { toast.error("Üretilecek ürünü seçin."); return; }
    if (!valid.length) { toast.error("En az bir hammadde ekleyin."); return; }
    const payload = {
      company_id: companyId,
      ...f,
      contact_id: f.contact_id || null,
      contact_name: f.contact_name || null,
      job_file_name: (f.job_file_name || "").trim() || null,
      steps: steps.filter((x) => x.name?.trim()).map((x, i) => ({ no: i + 1, name: x.name.trim(), station: x.station || "Genel", duration_min: Number(x.duration_min || 0) })),
      code: recipe?.code || "",
      name: f.name || `${fp?.name} Reçetesi`,
      finished_product_name: fp?.name || "",
      target_quantity: Number(f.target_quantity),
      labor_cost: Number(f.labor_cost),
      overhead_cost: Number(f.overhead_cost),
      materials: valid.map((m) => ({
        ...m,
        quantity: Number(m.quantity),
        cost_per_unit: Number(m.cost_per_unit),
        wastage_percent: Number(m.wastage_percent || 0),
        cost_includes_vat: !!m.cost_includes_vat,
        vat_rate: Number(m.vat_rate ?? 20),
      })),
    };
    try {
      if (recipe) await axios.put(`${API_URL}/production/recipes/${recipe.id}`, payload); else await axios.post(`${API_URL}/production/recipes`, payload);
      toast.success(recipe ? "Reçete güncellendi." : "Reçete oluşturuldu."); onSaved?.(); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); }
  };
  const cls = "w-full bg-slate-50 border rounded-lg p-2";
  const zoneOptions = zones.length ? zones : [];
  const stationOptions = stations.length ? stations : [];
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full p-5 space-y-4 text-xs shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="recipe-modal">
        <div className="flex justify-between items-start border-b pb-2"><h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><BookOpen className="w-4 h-4 text-emerald-600" /> {recipe ? `Reçete Düzenle — ${recipe.code}` : "Yeni Reçete (Ürün Ağacı / BOM)"}</h3><button onClick={onClose} className="text-slate-400" data-testid="recipe-close"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="col-span-2"><label className="block font-semibold mb-1">Üretilecek Ürün (Mamul) *</label><SearchSelect value={f.finished_product_id} options={finished} placeholder="Ürün ara…" getLabel={(p) => p.name} getSub={(p) => `${p.sku} • Stok: ${p.stock_quantity}`} onChange={(id, p) => setF({ ...f, finished_product_id: id, unit: p?.unit || f.unit, name: f.name || (p ? `${p.name} Reçetesi` : "") })} testId="recipe-product" /></div>
          <div><label className="block font-semibold mb-1">Bu reçete kaç {f.unit} üretir?</label><input type="number" min="0.001" step="any" value={f.target_quantity} onChange={(e) => setF({ ...f, target_quantity: e.target.value })} className={`${cls} font-bold`} data-testid="recipe-target-qty" /></div>
          <div><label className="block font-semibold mb-1">Reçete Adı</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Standart üretim" className={cls} data-testid="recipe-name" /></div>
          <div className="col-span-2"><label className="block font-semibold mb-1">Müşteri (Cari)</label><SearchSelect value={f.contact_id} options={contacts} placeholder="Cari ara…" getLabel={(c) => c.name} getSub={(c) => [c.phone, c.tax_number_or_id].filter(Boolean).join(" · ")} onChange={pickContact} testId="recipe-contact" /></div>
          <div className="col-span-2"><label className="block font-semibold mb-1">İş dosyası adı</label><input value={f.job_file_name} onChange={(e) => setF({ ...f, job_file_name: e.target.value })} placeholder="Örn. AHM-2026-014 / Villa mutfak" className={cls} data-testid="recipe-job-file" /></div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1"><span className="font-bold text-slate-800">Hammaddeler / Bileşenler</span><button onClick={() => setMats([...mats, emptyMat()])} className="flex items-center gap-1 text-emerald-700 font-semibold" data-testid="recipe-add-material"><Plus className="w-3.5 h-3.5" /> Hammadde Ekle</button></div>
          <div className="grid grid-cols-12 gap-1 px-1 text-[10px] uppercase font-semibold text-slate-400"><div className="col-span-4">Hammadde</div><div className="col-span-2 text-center">Miktar</div><div className="col-span-1 text-center">Fire %</div><div className="col-span-3 text-right">Birim Maliyet / KDV</div><div className="col-span-2 text-right">Tutar</div></div>
          <div className="space-y-1.5">
            {mats.map((m, i) => (
              <div key={i} className="grid grid-cols-12 gap-1 items-center bg-slate-50 border border-slate-200 rounded-lg p-1.5" data-testid={`recipe-material-${i}`}>
                <div className="col-span-4"><SearchSelect value={m.product_id} options={materialsSrc.filter((p) => p.id !== f.finished_product_id)} placeholder="Hammadde ara…" getLabel={(p) => p.name} getSub={(p) => `${p.sku} • Stok: ${p.stock_quantity} ${p.unit}`} onChange={(id) => pickMat(i, id)} testId={`recipe-mat-select-${i}`} /></div>
                <div className="col-span-2 flex items-center gap-1"><input type="number" min="0" step="any" value={m.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} className="w-full bg-white border rounded p-1.5 text-center font-semibold" data-testid={`recipe-mat-qty-${i}`} /><span className="text-slate-400 text-[10px]">{m.unit}</span></div>
                <div className="col-span-1"><input type="number" min="0" step="any" value={m.wastage_percent} onChange={(e) => upd(i, { wastage_percent: e.target.value })} className="w-full bg-white border rounded p-1.5 text-center" title="Fire / kayıp yüzdesi" /></div>
                <div className="col-span-3 flex items-center gap-1">
                  <input type="number" min="0" step="any" value={m.cost_per_unit} onChange={(e) => upd(i, { cost_per_unit: e.target.value })} className="w-full min-w-0 bg-white border rounded p-1.5 text-right" data-testid={`recipe-mat-cost-${i}`} />
                  <select
                    value={m.cost_includes_vat ? "incl" : "excl"}
                    onChange={(e) => upd(i, { cost_includes_vat: e.target.value === "incl" })}
                    className="shrink-0 bg-white border rounded p-1.5 text-[10px] font-semibold text-slate-700"
                    title="Birim maliyet KDV dahil / hariç"
                    data-testid={`recipe-mat-vat-${i}`}
                  >
                    <option value="excl">Hariç</option>
                    <option value="incl">Dahil</option>
                  </select>
                </div>
                <div className="col-span-1 text-right font-bold" data-testid={`recipe-mat-line-${i}`}>{fmt(materialLineCost(m))}</div>
                <div className="col-span-1 text-right"><button onClick={() => setMats(mats.filter((_, idx) => idx !== i))} className="text-rose-500 p-1" title="Kaldır"><Trash2 className="w-3.5 h-3.5" /></button></div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1"><span className="font-bold text-slate-800 flex items-center gap-1"><ListOrdered className="w-3.5 h-3.5" /> Üretim Adımları (Atölye iş emirleri)</span><button onClick={() => setSteps([...steps, { name: "", station: "", duration_min: 0 }])} className="flex items-center gap-1 text-emerald-700 font-semibold" data-testid="recipe-add-step"><Plus className="w-3.5 h-3.5" /> Adım Ekle</button></div>
          {steps.length === 0 && <p className="text-[11px] text-slate-400">Adım tanımlanmazsa tek adımlı (&quot;Üretim&quot;) iş emri oluşur. Bölümler Firma Ayarları → Atölye Bölge; istasyonlar Parkur listesinden gelir.</p>}
          <div className="space-y-1.5">{steps.map((st, i) => (
            <div key={i} className="grid grid-cols-12 gap-1 items-center bg-slate-50 border border-slate-200 rounded-lg p-1.5" data-testid={`recipe-step-${i}`}>
              <div className="col-span-1 text-center font-bold text-slate-500">{i + 1}</div>
              <div className="col-span-5">
                {zoneOptions.length ? (
                  <select
                    value={st.name || ""}
                    onChange={(e) => updStep(i, { name: e.target.value })}
                    className="w-full bg-white border rounded p-1.5"
                    data-testid={`recipe-step-name-${i}`}
                  >
                    <option value="">Bölüm seç…</option>
                    {zoneOptions.map((z) => <option key={z} value={z}>{z}</option>)}
                    {st.name && !zoneOptions.includes(st.name) ? <option value={st.name}>{st.name}</option> : null}
                  </select>
                ) : (
                  <input value={st.name} onChange={(e) => updStep(i, { name: e.target.value })} placeholder="Bölüm (Firma Ayarları → Atölye Bölge)" className="w-full bg-white border rounded p-1.5" data-testid={`recipe-step-name-${i}`} />
                )}
              </div>
              <div className="col-span-3">
                {stationOptions.length ? (
                  <select
                    value={st.station || ""}
                    onChange={(e) => updStep(i, { station: e.target.value })}
                    className="w-full bg-white border rounded p-1.5"
                    data-testid={`recipe-step-station-${i}`}
                  >
                    <option value="">İstasyon / Makine</option>
                    {stationOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                    {st.station && !stationOptions.includes(st.station) ? <option value={st.station}>{st.station}</option> : null}
                  </select>
                ) : (
                  <input value={st.station} onChange={(e) => updStep(i, { station: e.target.value })} placeholder="İstasyon / Makine (Parkur)" className="w-full bg-white border rounded p-1.5" data-testid={`recipe-step-station-${i}`} />
                )}
              </div>
              <div className="col-span-2 flex items-center gap-1"><input type="number" min="0" value={st.duration_min} onChange={(e) => updStep(i, { duration_min: e.target.value })} className="w-full bg-white border rounded p-1.5 text-center" title="Hedef süre (dk)" /><span className="text-[10px] text-slate-400">dk</span></div>
              <div className="col-span-1 text-right"><button onClick={() => setSteps(steps.filter((_, idx) => idx !== i))} className="text-rose-500 p-1"><Trash2 className="w-3.5 h-3.5" /></button></div>
            </div>))}</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
          <div><label className="block font-semibold mb-1">İşçilik (₺)</label><input type="number" min="0" step="any" value={f.labor_cost} onChange={(e) => setF({ ...f, labor_cost: e.target.value })} className={cls} data-testid="recipe-labor" /></div>
          <div><label className="block font-semibold mb-1">Genel Gider (₺)</label><input type="number" min="0" step="any" value={f.overhead_cost} onChange={(e) => setF({ ...f, overhead_cost: e.target.value })} className={cls} data-testid="recipe-overhead" /></div>
          <div className="col-span-2 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 flex justify-between items-center" data-testid="recipe-cost-summary"><div><div className="text-[10px] uppercase font-bold text-emerald-700">Toplam Maliyet (KDV hariç)</div><div className="font-bold text-slate-900">{fmt(total)} ₺</div></div><div className="text-right"><div className="text-[10px] uppercase font-bold text-emerald-700">Birim Maliyet</div><div className="text-base font-black text-emerald-700">{fmt(unitCost)} ₺ / {f.unit}</div>{fp?.sale_price > 0 && <div className="text-[10px] text-slate-500">Satış {fmt(fp.sale_price)} ₺ → kâr %{(((fp.sale_price - unitCost) / fp.sale_price) * 100).toFixed(0)}</div>}</div></div>
        </div>
        <div><label className="block font-semibold mb-1">Üretim Notu / Talimat</label><textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className={cls} placeholder="Montaj sırası, kalite kontrol…" /></div>
        <div className="flex justify-end gap-2 border-t pt-2"><button onClick={onClose} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={save} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="recipe-save">{recipe ? "Güncelle" : "Reçeteyi Kaydet"}</button></div>
      </div>
    </div>
  );
};
