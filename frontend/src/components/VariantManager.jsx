
import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plus, X, Wand2, Trash2, Save, ImagePlus, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";
import { compressImageFile } from "../utils/compressImage";

const cartesian = (options) =>
  options.reduce((acc, opt) => acc.flatMap((combo) => opt.values.map((v) => ({ ...combo, [opt.name]: v }))), [{}]);

const OptionEditor = ({ option, onChange, onRemove }) => {
  const [value, setValue] = useState("");
  const addValue = () => {
    const v = value.trim();
    if (!v || option.values.includes(v)) return;
    onChange({ ...option, values: [...option.values, v] });
    setValue("");
  };
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2" data-testid="variant-option-editor">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Seçenek adı (Renk, Beden...)"
          value={option.name}
          onChange={(e) => onChange({ ...option, name: e.target.value })}
          className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1.5 font-semibold text-slate-800"
          data-testid="variant-option-name-input"
        />
        <button type="button" onClick={onRemove} className="p-1.5 text-slate-400 hover:text-rose-600" data-testid="remove-variant-option-btn"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {option.values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-700">
            {v}
            <button type="button" onClick={() => onChange({ ...option, values: option.values.filter((x) => x !== v) })} className="text-slate-400 hover:text-rose-600"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <input
          type="text"
          placeholder="Değer ekle + Enter"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addValue(); } }}
          className="bg-white border border-dashed border-slate-300 rounded-md px-2 py-0.5 text-[11px] w-36"
          data-testid="variant-option-value-input"
        />
      </div>
    </div>
  );
};

const VariantImageCell = ({ product, variant, onUpdated }) => {
  const [busy, setBusy] = useState(false);
  const pid = product?.id || product?._id;
  const upload = async (e) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw || !pid) return;
    setBusy(true);
    try {
      const file = await compressImageFile(raw);
      const form = new FormData();
      form.append("file", file);
      const res = await axios.post(`${API_URL}/products/${pid}/image?variant_id=${variant.variant_id}`, form, { withCredentials: true });
      if (!res.data?.product) {
        toast.error("Görsel kaydedildi ama kart yenilenemedi.");
        return;
      }
      onUpdated(res.data.product);
      toast.success("Varyant görseli yüklendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Görsel yüklenemedi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="w-9 h-9 rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center text-slate-400 hover:border-emerald-500 cursor-pointer" title="Varyant görseli" data-testid="variant-image-btn">
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : variant.image_url ? <img src={resolveImageUrl(variant.image_url)} alt="" className="w-full h-full object-cover" /> : <ImagePlus className="w-4 h-4" />}
      <input type="file" accept="image/*" className="sr-only" onChange={upload} disabled={busy} />
    </label>
  );
};

export const VariantManager = ({ product, onUpdated }) => {
  const [options, setOptions] = useState(product.variant_options || []);
  const [variants, setVariants] = useState(product.variants || []);
  const [saving, setSaving] = useState(false);

  const updateOption = (idx, next) => setOptions(options.map((o, i) => (i === idx ? next : o)));

  const generate = () => {
    const valid = options.filter((o) => o.name.trim() && o.values.length);
    if (!valid.length) { toast.error("En az bir seçenek ve değer girin."); return; }
    const combos = cartesian(valid);
    const next = combos.map((attrs) => {
      const name = Object.values(attrs).join(" / ");
      const existing = variants.find((v) => v.name === name);
      return existing || {
        variant_id: Math.random().toString(36).slice(2, 10),
        name,
        attributes: attrs,
        sku: `${product.sku}-${Object.values(attrs).map((s) => s.slice(0, 3).toUpperCase()).join("-")}`,
        barcode: "",
        stock: 0,
        price: product.sale_price || 0,
        image_url: null
      };
    });
    setVariants(next);
    toast.success(`${next.length} varyant kombinasyonu oluşturuldu.`);
  };

  const updateVariant = (idx, field, value) => setVariants(variants.map((v, i) => (i === idx ? { ...v, [field]: value } : v)));

  const save = async () => {
    try {
      setSaving(true);
      const payload = {
        variant_options: options.filter((o) => o.name.trim()),
        variants: variants.map((v) => ({ ...v, stock: Number(v.stock || 0), price: Number(v.price || 0), attributes: v.attributes || {} }))
      };
      const res = await axios.put(`${API_URL}/products/${product.id}/variants`, payload, { withCredentials: true });
      onUpdated(res.data);
      setVariants(res.data.variants || []);
      toast.success("Varyantlar kaydedildi. Toplam stok güncellendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Varyantlar kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  };

  const totalStock = variants.reduce((s, v) => s + Number(v.stock || 0), 0);

  return (
    <div className="space-y-4 text-xs" data-testid="variant-manager">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-slate-800">Varyant Seçenekleri</h4>
          <button type="button" onClick={() => setOptions([...options, { name: "", values: [] }])} className="flex items-center gap-1 text-indigo-600 font-semibold hover:underline" data-testid="add-variant-option-btn">
            <Plus className="w-3.5 h-3.5" /> Seçenek Ekle
          </button>
        </div>
        {options.length === 0 && <p className="text-slate-500">Örn: Renk → Siyah, Beyaz; Beden → S, M, L. Sonra kombinasyonları otomatik oluşturun.</p>}
        {options.map((opt, idx) => (
          <OptionEditor key={idx} option={opt} onChange={(n) => updateOption(idx, n)} onRemove={() => setOptions(options.filter((_, i) => i !== idx))} />
        ))}
        {options.length > 0 && (
          <button type="button" onClick={generate} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg font-semibold hover:bg-indigo-100" data-testid="generate-variants-btn">
            <Wand2 className="w-3.5 h-3.5" /> Kombinasyonları Oluştur
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-slate-800">Varyantlar <span className="text-slate-400 font-medium">({variants.length}) • Toplam Stok: {totalStock}</span></h4>
          <button
            type="button"
            onClick={() => setVariants([...variants, { variant_id: Math.random().toString(36).slice(2, 10), name: "", attributes: {}, sku: "", barcode: "", stock: 0, price: product.sale_price || 0, image_url: null }])}
            className="flex items-center gap-1 text-emerald-600 font-semibold hover:underline"
            data-testid="add-manual-variant-btn"
          >
            <Plus className="w-3.5 h-3.5" /> Manuel Varyant
          </button>
        </div>
        {variants.length > 0 && (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold">
                <tr>
                  <th className="px-2 py-2">Görsel</th>
                  <th className="px-2 py-2">Varyant Adı</th>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2">Barkod</th>
                  <th className="px-2 py-2 w-20">Stok</th>
                  <th className="px-2 py-2 w-24">Fiyat ₺</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {variants.map((v, idx) => (
                  <tr key={v.variant_id} data-testid={`variant-row-${idx}`}>
                    <td className="px-2 py-1.5"><VariantImageCell product={product} variant={v} onUpdated={(p) => { onUpdated(p); setVariants(p.variants || []); }} /></td>
                    <td className="px-2 py-1.5"><input value={v.name} onChange={(e) => updateVariant(idx, "name", e.target.value)} className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 font-semibold" data-testid="variant-name-input" /></td>
                    <td className="px-2 py-1.5"><input value={v.sku} onChange={(e) => updateVariant(idx, "sku", e.target.value)} className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 font-mono" data-testid="variant-sku-input" /></td>
                    <td className="px-2 py-1.5"><input value={v.barcode || ""} placeholder="Otomatik" onChange={(e) => updateVariant(idx, "barcode", e.target.value)} className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 font-mono" data-testid="variant-barcode-input" /></td>
                    <td className="px-2 py-1.5"><input type="number" value={v.stock} onChange={(e) => updateVariant(idx, "stock", e.target.value)} className="w-full bg-white border border-slate-200 rounded-md px-2 py-1 font-bold" data-testid="variant-stock-input" /></td>
                    <td className="px-2 py-1.5"><input type="number" value={v.price} onChange={(e) => updateVariant(idx, "price", e.target.value)} className="w-full bg-white border border-slate-200 rounded-md px-2 py-1" data-testid="variant-price-input" /></td>
                    <td className="px-2 py-1.5"><button type="button" onClick={() => setVariants(variants.filter((_, i) => i !== idx))} className="p-1 text-slate-400 hover:text-rose-600" data-testid="remove-variant-btn"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex justify-end pt-2 border-t">
        <button type="button" onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-60" data-testid="save-variants-btn">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Varyantları Kaydet
        </button>
      </div>
    </div>
  );
};
