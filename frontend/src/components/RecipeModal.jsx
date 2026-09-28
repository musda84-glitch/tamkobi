import React, { useEffect, useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Plus, Trash2, BookOpen, ListOrdered, ImagePlus, ArrowDownUp } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { SearchSelect } from "./SearchSelect";
import { formatTrAmount } from "../utils/money";
import { normalizeWorkParks, normalizeWorkshopZones, stationNamesFromParks, zoneNamesFromList } from "../utils/workParks";
import { compressImageFile } from "../utils/compressImage";
import { HoverImageThumb } from "../utils/HoverImageThumb";
import { sameStationOrderHint } from "../utils/recipeStationOrder";
import { backdropDismissProps } from "../utils/modalBackdrop";

const fmt = (n) => formatTrAmount((n || 0));

/** Birim maliyet net (KDV hariç) — reçete toplamı için.
 *  cost_includes_vat=true → girilen tutar KDV dahil; false → KDV hariç. */
export const materialUnitNet = (m) => {
  const cost = Number(m?.cost_per_unit || 0);
  if (!m?.cost_includes_vat) return cost;
  // Eksik oranda stok/eski kayıt için %20; açıkça 0 ise KDV yok.
  const rate = m?.vat_rate == null || m?.vat_rate === "" ? 20 : Number(m.vat_rate);
  if (!(rate > 0)) return cost;
  return cost / (1 + rate / 100);
};

export const materialLineCost = (m) =>
  materialUnitNet(m) * Number(m?.quantity || 0) * (1 + Number(m?.wastage_percent || 0) / 100);

export const normalizeStepImages = (list) => {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const url = typeof item === "string" ? item.trim() : String(item?.url || item?.image_url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= 12) break;
  }
  return out;
};

const emptyStep = (station = "", name = "") => ({ name, station, duration_min: 0, note: "", images: [] });

const emptyMat = () => ({
  product_id: "",
  product_name: "",
  quantity: 1,
  unit: "Adet",
  cost_per_unit: 0,
  wastage_percent: 0,
  cost_includes_vat: false,
  vat_rate: 20,
  steps: [],
});

/** API / eski kayıtlarda steps bazen JSON string gelebilir. */
export const coerceStepsList = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const normalizeSteps = (list) =>
  coerceStepsList(list).map((x) => ({
    name: x?.name || "",
    station: x?.station || "",
    duration_min: x?.duration_min ?? 0,
    note: typeof x?.note === "string" ? x.note : (x?.note != null ? String(x.note) : ""),
    images: normalizeStepImages(x?.images),
  }));

export const materialsFromRecipe = (recipe) => {
  const mats = Array.isArray(recipe?.materials) ? recipe.materials : [];
  if (!mats.length) return [emptyMat()];
  return mats.map((m) => ({
    ...emptyMat(),
    ...m,
    cost_includes_vat: !!m.cost_includes_vat,
    vat_rate: Number(m.vat_rate ?? 20),
    steps: normalizeSteps(m.steps),
  }));
};

/** Adım adı (bölüm) boşsa istasyon adını kullan — sessizce düşmesin. */
export const serializeSteps = (list, fallbackStation = "") =>
  normalizeSteps(list)
    .map((x) => {
      const name = (x.name || "").trim() || (x.station || "").trim();
      const station = (x.station || "").trim() || fallbackStation || "";
      return { ...x, name, station };
    })
    .filter((x) => x.name)
    .map((x, i) => ({
      no: i + 1,
      name: x.name,
      station: x.station,
      duration_min: Number(x.duration_min || 0),
      note: (x.note || "").trim() || "",
      images: normalizeStepImages(x.images),
    }));

/** Adım satırı — istasyona özel reçete görselleri. */
const StepImages = ({ images, onChange, companyId, recipeId, testId }) => {
  const [busy, setBusy] = useState(false);
  const imgs = normalizeStepImages(images);
  const upload = async (e) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw) return;
    if (!companyId) { toast.error("Firma seçili değil."); return; }
    setBusy(true);
    try {
      const file = await compressImageFile(raw);
      const fd = new FormData();
      fd.append("file", file);
      const q = new URLSearchParams({
        entity: "recipe",
        entity_id: recipeId || "",
        company_id: companyId,
      });
      const r = await axios.post(`${API_URL}/files/upload?${q}`, fd);
      const url = r.data?.url;
      if (!url) throw new Error("url yok");
      onChange([...imgs, url]);
      toast.success("Görsel yüklendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görsel yüklenemedi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col-span-12 flex items-center gap-1.5 flex-wrap pl-7 pt-0.5" data-testid={testId}>
      <span className="text-[10px] font-semibold uppercase text-slate-400 shrink-0">İstasyon görselleri</span>
      {imgs.map((url) => (
        <div key={url} className="relative group">
          <HoverImageThumb src={url} className="w-9 h-9 rounded-md object-cover border border-slate-200" testId={`${testId}-thumb`} />
          <button
            type="button"
            onClick={() => onChange(imgs.filter((u) => u !== url))}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] leading-none opacity-0 group-hover:opacity-100"
            title="Kaldır"
            data-testid={`${testId}-remove`}
          >
            ×
          </button>
        </div>
      ))}
      <label
        className={`w-9 h-9 rounded-md border-2 border-dashed flex items-center justify-center cursor-pointer shrink-0 ${busy ? "opacity-50 border-slate-200" : "border-slate-300 hover:border-emerald-500 text-slate-400"}`}
        title="Bu istasyon adımına görsel ekle"
      >
        {busy ? <span className="text-[9px]">…</span> : <ImagePlus className="w-3.5 h-3.5" />}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" className="hidden" onChange={upload} disabled={busy} data-testid={`${testId}-upload`} />
      </label>
    </div>
  );
};

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
    one_time: !!recipe?.one_time,
    group_same_station: !!recipe?.group_same_station,
  });
  const [steps, setSteps] = useState(normalizeSteps(recipe?.steps));
  const updStep = (i, patch) => setSteps(steps.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const [mats, setMats] = useState(() => materialsFromRecipe(recipe));
  const stationOrderHint = sameStationOrderHint(mats, steps, !!f.group_same_station);
  const upd = (i, patch) => setMats(mats.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const updMatStep = (mi, si, patch) => {
    const cur = mats[mi]?.steps || [];
    upd(mi, { steps: cur.map((x, idx) => (idx === si ? { ...x, ...patch } : x)) });
  };
  const addMatStep = (mi) => {
    const cur = mats[mi]?.steps || [];
    upd(mi, { steps: [...cur, emptyStep(stations[0] || "", zones[0] || "")] });
  };
  const removeMatStep = (mi, si) => {
    const cur = mats[mi]?.steps || [];
    upd(mi, { steps: cur.filter((_, idx) => idx !== si) });
  };
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
    const generalSteps = serializeSteps(steps, stations[0] || "");
    const matsWithSteps = valid.map((m) => ({
      product_id: m.product_id,
      product_name: m.product_name,
      unit: m.unit,
      quantity: Number(m.quantity),
      cost_per_unit: Number(m.cost_per_unit),
      wastage_percent: Number(m.wastage_percent || 0),
      cost_includes_vat: !!m.cost_includes_vat,
      vat_rate: Number(m.vat_rate ?? 20),
      steps: serializeSteps(m.steps, stations[0] || ""),
    }));
    const uiStepCount =
      normalizeSteps(steps).filter((x) => (x.name || "").trim() || (x.station || "").trim() || (x.images || []).length).length
      + valid.reduce(
        (n, m) => n + normalizeSteps(m.steps).filter((x) => (x.name || "").trim() || (x.station || "").trim() || (x.images || []).length).length,
        0
      );
    const savedStepCount = generalSteps.length + matsWithSteps.reduce((n, m) => n + (m.steps || []).length, 0);
    if (uiStepCount > 0 && savedStepCount === 0) {
      toast.error("Adımlar kaydedilemedi: her adımda bölüm veya istasyon seçin.");
      return;
    }
    const payload = {
      company_id: companyId,
      ...f,
      contact_id: f.contact_id || null,
      contact_name: f.contact_name || null,
      job_file_name: (f.job_file_name || "").trim() || null,
      steps: generalSteps,
      code: recipe?.code || "",
      name: f.name || `${fp?.name} Reçetesi`,
      finished_product_name: fp?.name || "",
      target_quantity: Number(f.target_quantity),
      labor_cost: Number(f.labor_cost),
      overhead_cost: Number(f.overhead_cost),
      one_time: !!f.one_time,
      group_same_station: !!f.group_same_station,
      materials: matsWithSteps,
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
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-center justify-center p-4" {...backdropDismissProps(onClose)}>
      <div className="bg-white rounded-2xl max-w-3xl w-full p-5 space-y-4 text-xs shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="recipe-modal">
        <div className="flex justify-between items-start border-b pb-2"><h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><BookOpen className="w-4 h-4 text-emerald-600" /> {recipe ? `Reçete Düzenle — ${recipe.code}` : "Yeni Reçete (Ürün Ağacı / BOM)"}</h3><button onClick={onClose} className="text-slate-400" data-testid="recipe-close"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="col-span-2"><label className="block font-semibold mb-1">Üretilecek Ürün (Mamul) *</label><SearchSelect value={f.finished_product_id} options={finished} placeholder="Ürün ara…" getLabel={(p) => p.name} getSub={(p) => `${p.sku} • Stok: ${p.stock_quantity}`} onChange={(id, p) => setF({ ...f, finished_product_id: id, unit: p?.unit || f.unit, name: f.name || (p ? `${p.name} Reçetesi` : "") })} testId="recipe-product" /></div>
          <div><label className="block font-semibold mb-1">Bu reçete kaç {f.unit} üretir?</label><input type="number" min="0.001" step="any" value={f.target_quantity} onChange={(e) => setF({ ...f, target_quantity: e.target.value })} className={`${cls} font-bold`} data-testid="recipe-target-qty" /></div>
          <div><label className="block font-semibold mb-1">Reçete Adı</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Standart üretim" className={cls} data-testid="recipe-name" /></div>
          <div className="col-span-2"><label className="block font-semibold mb-1">Müşteri (Cari)</label><SearchSelect value={f.contact_id} options={contacts} placeholder="Cari ara…" getLabel={(c) => c.name} getSub={(c) => [c.phone, c.tax_number_or_id].filter(Boolean).join(" · ")} onChange={pickContact} testId="recipe-contact" /></div>
          <div className="col-span-2"><label className="block font-semibold mb-1">İş dosyası adı</label><input value={f.job_file_name} onChange={(e) => setF({ ...f, job_file_name: e.target.value })} placeholder="Örn. AHM-2026-014 / Villa mutfak" className={cls} data-testid="recipe-job-file" /></div>
          <div className="col-span-2 sm:col-span-4 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer select-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 hover:bg-slate-100/80" data-testid="recipe-one-time-wrap">
              <input
                type="checkbox"
                checked={!!f.one_time}
                onChange={(e) => setF({ ...f, one_time: e.target.checked })}
                className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                data-testid="recipe-one-time"
              />
              <span>
                <span className="block font-semibold text-slate-800">Tek seferlik reçete</span>
                <span className="block text-[11px] text-slate-500 font-normal mt-0.5">İşaretlenirse bu reçeteyle üretim tamamlandığında reçete otomatik silinir.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer select-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 hover:bg-slate-100/80" data-testid="recipe-group-station-wrap">
              <input
                type="checkbox"
                checked={!!f.group_same_station}
                onChange={(e) => setF({ ...f, group_same_station: e.target.checked })}
                className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                data-testid="recipe-group-same-station"
              />
              <span>
                <span className="block font-semibold text-slate-800">Aynı istasyonu peşi sıra işle</span>
                <span className="block text-[11px] text-slate-500 font-normal mt-0.5">Açıkken atölye iş emirleri istasyona göre gruplanır (ör. tüm HOLZHER kesimleri ardışık).</span>
              </span>
            </label>
          </div>
        </div>
        {stationOrderHint && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 text-amber-900" data-testid="recipe-station-order-hint">
            <div className="flex-1 text-[11px] leading-snug">
              <span className="font-bold">Öneri: </span>
              {stationOrderHint.message}
            </div>
            <button
              type="button"
              onClick={() => {
                setF((prev) => ({ ...prev, group_same_station: true }));
                toast.success("Peşi sıra istasyon sıralaması açıldı. Kaydedince atölyede uygulanır.");
              }}
              className="shrink-0 inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px]"
              data-testid="recipe-station-order-apply"
            >
              <ArrowDownUp className="w-3.5 h-3.5" /> Peşi sıra uygula
            </button>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-1"><span className="font-bold text-slate-800">Hammaddeler / Bileşenler</span><button onClick={() => setMats([...mats, emptyMat()])} className="flex items-center gap-1 text-emerald-700 font-semibold" data-testid="recipe-add-material"><Plus className="w-3.5 h-3.5" /> Hammadde Ekle</button></div>
          <div className="grid grid-cols-12 gap-1 px-1 text-[10px] uppercase font-semibold text-slate-400"><div className="col-span-4">Hammadde</div><div className="col-span-2 text-center">Miktar</div><div className="col-span-1 text-center">Fire %</div><div className="col-span-3 text-right">Birim Maliyet / KDV</div><div className="col-span-2 text-right">Tutar</div></div>
          <div className="space-y-2">
            {mats.map((m, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/80 overflow-hidden" data-testid={`recipe-material-${i}`}>
                <div className="grid grid-cols-12 gap-1 items-center p-1.5">
                  <div className="col-span-4"><SearchSelect value={m.product_id} options={materialsSrc.filter((p) => p.id !== f.finished_product_id)} placeholder="Hammadde ara…" getLabel={(p) => p.name} getSub={(p) => `${p.sku} • Stok: ${p.stock_quantity} ${p.unit}`} onChange={(id) => pickMat(i, id)} testId={`recipe-mat-select-${i}`} /></div>
                  <div className="col-span-2 flex items-center gap-1"><input type="number" min="0" step="any" value={m.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} className="w-full bg-white border rounded p-1.5 text-center font-semibold" data-testid={`recipe-mat-qty-${i}`} /><span className="text-slate-400 text-[10px]">{m.unit}</span></div>
                  <div className="col-span-1"><input type="number" min="0" step="any" value={m.wastage_percent} onChange={(e) => upd(i, { wastage_percent: e.target.value })} className="w-full bg-white border rounded p-1.5 text-center" title="Fire / kayıp yüzdesi" /></div>
                  <div className="col-span-3 flex flex-col gap-0.5 min-w-0">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={m.cost_per_unit}
                        onChange={(e) => upd(i, { cost_per_unit: e.target.value })}
                        className="w-full min-w-0 bg-white border rounded p-1.5 text-right"
                        title={m.cost_includes_vat ? "KDV dahil birim fiyat" : "KDV hariç birim fiyat"}
                        placeholder={m.cost_includes_vat ? "Dahil fiyat" : "Hariç fiyat"}
                        data-testid={`recipe-mat-cost-${i}`}
                      />
                      <select
                        value={m.cost_includes_vat ? "incl" : "excl"}
                        onChange={(e) => upd(i, { cost_includes_vat: e.target.value === "incl" })}
                        className="shrink-0 bg-white border rounded p-1.5 text-[10px] font-semibold text-slate-700"
                        title="Girilen tutar KDV dahil mi, hariç mi?"
                        data-testid={`recipe-mat-vat-${i}`}
                      >
                        <option value="excl">Hariç</option>
                        <option value="incl">Dahil</option>
                      </select>
                    </div>
                    {m.cost_includes_vat && Number(m.cost_per_unit) > 0 && (
                      <div className="text-[9px] text-slate-500 text-right pr-14" data-testid={`recipe-mat-net-${i}`}>
                        net {fmt(materialUnitNet(m))}
                      </div>
                    )}
                  </div>
                  <div className="col-span-1 text-right font-bold" data-testid={`recipe-mat-line-${i}`}>{fmt(materialLineCost(m))}</div>
                  <div className="col-span-1 text-right"><button onClick={() => setMats(mats.filter((_, idx) => idx !== i))} className="text-rose-500 p-1" title="Kaldır"><Trash2 className="w-3.5 h-3.5" /></button></div>
                </div>
                <div className="border-t border-slate-200/80 px-2 py-1.5 space-y-1.5 bg-white/60" data-testid={`recipe-mat-steps-${i}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">
                      <ListOrdered className="w-3 h-3" /> Bu kalem için üretim adımları
                      {(m.steps || []).length > 0 ? <span className="normal-case font-normal text-slate-400">({(m.steps || []).length})</span> : null}
                    </span>
                    <button type="button" onClick={() => addMatStep(i)} className="flex items-center gap-0.5 text-emerald-700 font-semibold text-[11px]" data-testid={`recipe-mat-add-step-${i}`}>
                      <Plus className="w-3 h-3" /> Adım Ekle
                    </button>
                  </div>
                  {(m.steps || []).length === 0 && (
                    <p className="text-[10px] text-slate-400">Boş bırakılırsa bu kalem için ayrı iş emri açılmaz; genel adımlar veya tek &quot;Üretim&quot; kullanılır.</p>
                  )}
                  {(m.steps || []).map((st, si) => (
                    <div key={si} className="grid grid-cols-12 gap-1 items-center" data-testid={`recipe-mat-${i}-step-${si}`}>
                      <div className="col-span-1 text-center font-bold text-slate-400 text-[10px]">{si + 1}</div>
                      <div className="col-span-5">
                        {zoneOptions.length ? (
                          <select value={st.name || ""} onChange={(e) => updMatStep(i, si, { name: e.target.value })} className="w-full bg-white border rounded p-1.5" data-testid={`recipe-mat-${i}-step-name-${si}`}>
                            <option value="">Bölüm seç…</option>
                            {zoneOptions.map((z) => <option key={z} value={z}>{z}</option>)}
                            {st.name && !zoneOptions.includes(st.name) ? <option value={st.name}>{st.name}</option> : null}
                          </select>
                        ) : (
                          <input value={st.name} onChange={(e) => updMatStep(i, si, { name: e.target.value })} placeholder="Bölüm" className="w-full bg-white border rounded p-1.5" data-testid={`recipe-mat-${i}-step-name-${si}`} />
                        )}
                      </div>
                      <div className="col-span-3">
                        {stationOptions.length ? (
                          <select value={st.station || ""} onChange={(e) => updMatStep(i, si, { station: e.target.value })} className="w-full bg-white border rounded p-1.5" data-testid={`recipe-mat-${i}-step-station-${si}`}>
                            <option value="">İstasyon</option>
                            {stationOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                            {st.station && !stationOptions.includes(st.station) ? <option value={st.station}>{st.station}</option> : null}
                          </select>
                        ) : (
                          <input value={st.station} onChange={(e) => updMatStep(i, si, { station: e.target.value })} placeholder="İstasyon" className="w-full bg-white border rounded p-1.5" data-testid={`recipe-mat-${i}-step-station-${si}`} />
                        )}
                      </div>
                      <div className="col-span-2 flex items-center gap-1"><input type="number" min="0" value={st.duration_min} onChange={(e) => updMatStep(i, si, { duration_min: e.target.value })} className="w-full bg-white border rounded p-1.5 text-center" title="Hedef süre (dk)" /><span className="text-[10px] text-slate-400">dk</span></div>
                      <div className="col-span-1 text-right"><button type="button" onClick={() => removeMatStep(i, si)} className="text-rose-500 p-1" data-testid={`recipe-mat-${i}-step-del-${si}`}><Trash2 className="w-3.5 h-3.5" /></button></div>
                      <div className="col-span-12 pl-7">
                        <textarea
                          rows={2}
                          value={st.note || ""}
                          onChange={(e) => updMatStep(i, si, { note: e.target.value })}
                          placeholder="Atölyede iş dosyası yanında görünecek not / yazı…"
                          className="w-full bg-white border rounded p-1.5 text-[11px] resize-y min-h-[2.25rem]"
                          data-testid={`recipe-mat-${i}-step-note-${si}`}
                        />
                      </div>
                      <StepImages
                        images={st.images}
                        onChange={(images) => updMatStep(i, si, { images })}
                        companyId={companyId}
                        recipeId={recipe?.id}
                        testId={`recipe-mat-${i}-step-images-${si}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1"><span className="font-bold text-slate-800 flex items-center gap-1"><ListOrdered className="w-3.5 h-3.5" /> Genel üretim adımları</span><button onClick={() => setSteps([...steps, emptyStep(stationOptions[0] || "", zoneOptions[0] || "")])} className="flex items-center gap-1 text-emerald-700 font-semibold" data-testid="recipe-add-step"><Plus className="w-3.5 h-3.5" /> Adım Ekle</button></div>
          {steps.length === 0 && <p className="text-[11px] text-slate-400">Kalem adımlarından sonra uygulanır. Hiç adım yoksa tek adımlı (&quot;Üretim&quot;) iş emri oluşur. Bölümler Firma Ayarları → Atölye Bölge; istasyonlar Parkur listesinden gelir.</p>}
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
              <div className="col-span-12 pl-7">
                <textarea
                  rows={2}
                  value={st.note || ""}
                  onChange={(e) => updStep(i, { note: e.target.value })}
                  placeholder="Atölyede iş dosyası yanında görünecek not / yazı…"
                  className="w-full bg-white border rounded p-1.5 text-[11px] resize-y min-h-[2.25rem]"
                  data-testid={`recipe-step-note-${i}`}
                />
              </div>
              <StepImages
                images={st.images}
                onChange={(images) => updStep(i, { images })}
                companyId={companyId}
                recipeId={recipe?.id}
                testId={`recipe-step-images-${i}`}
              />
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
