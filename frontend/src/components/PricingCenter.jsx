
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Calculator, Upload, Save, Loader2, AlertTriangle } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const inp = "bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs";

export const PricingCenter = ({ companyId }) => {
  const [channel, setChannel] = useState("trendyol");
  const [rule, setRule] = useState(null);
  const [data, setData] = useState(null);
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const compute = useCallback((r) => { setBusy("compute"); return axios.post(`${API_URL}/pricing/compute`, { company_id: companyId, channel, rule: r || undefined }).then((res) => { setData(res.data); if (!r) setRule(res.data.rule); }).catch((e) => toast.error(e.response?.data?.detail || "Hesaplanamadı.")).finally(() => setBusy("")); }, [companyId, channel]);
  useEffect(() => { setSel([]); compute(); }, [compute]);
  const saveRule = async () => { setBusy("save"); try { await axios.put(`${API_URL}/pricing/rules/${channel}`, { company_id: companyId, ...rule }); toast.success("Fiyat kuralı kaydedildi."); compute(rule); } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(""); } };
  const push = async () => {
    const items = (data?.rows || []).filter((r) => sel.includes(r.barcode) && r.suggested).map((r) => ({ barcode: r.barcode, sale_price: r.suggested, list_price: r.list_price }));
    if (!items.length) { toast.error("Ürün seçin."); return; }
    if (!window.confirm(`${items.length} ürünün fiyatı ${channel === "trendyol" ? "Trendyol" : channel}'a gönderilsin mi? (Gerçek mağaza fiyatları değişir)`)) return;
    setBusy("push");
    try { const r = await axios.post(`${API_URL}/marketplace/products/push`, { company_id: companyId, channel, items }); toast.success(r.data.message); setSel([]); axios.get(`${API_URL}/marketplace/products`, { params: { company_id: companyId, channel, refresh: true } }).then(() => compute(rule)); }
    catch (e) { toast.error(e.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(""); }
  };
  const rows = (data?.rows || []).filter((r) => !onlyDiff || (r.suggested && Math.abs(r.diff) >= 1));
  const setR = (k, v) => setRule({ ...rule, [k]: v });
  return (
    <div className="space-y-3 text-xs" data-testid="pricing-center">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Calculator className="w-4 h-4 text-emerald-600" /> Fiyat Merkezi — maliyet + hedef kâr → pazaryeri satış fiyatı</h3>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inp} data-testid="pricing-channel"><option value="trendyol">Trendyol</option><option value="shopphp">ShopPHP (Web Sitesi)</option><option value="hepsiburada">Hepsiburada</option></select>
      </div>
      {rule && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-end gap-3" data-testid="pricing-rule">
          <label>Hedef kâr %<br /><input type="number" step="1" value={rule.margin_pct} onChange={(e) => setR("margin_pct", Number(e.target.value))} className={`${inp} w-20`} data-testid="rule-margin" /></label>
          <label>Kâr tabanı<br /><select value={rule.margin_base} onChange={(e) => setR("margin_base", e.target.value)} className={inp} data-testid="rule-base"><option value="cost">Maliyet üzerinden (kâr = maliyet × %)</option><option value="price">Satış fiyatı üzerinden (kâr = fiyat × %)</option></select></label>
          <label>Yuvarlama<br /><select value={rule.rounding} onChange={(e) => setR("rounding", e.target.value)} className={inp} data-testid="rule-rounding"><option value="0.90">…,90</option><option value="0.99">…,99</option><option value="1">Tam sayı</option><option value="5">5'in katı</option><option value="10">10'un katı</option><option value="none">Yok</option></select></label>
          <label>Min fiyat<br /><input type="number" value={rule.min_price} onChange={(e) => setR("min_price", Number(e.target.value))} className={`${inp} w-24`} /></label>
          <label>Max fiyat<br /><input type="number" value={rule.max_price} onChange={(e) => setR("max_price", Number(e.target.value))} className={`${inp} w-24`} /></label>
          <label>Liste fiyatı +%<br /><input type="number" value={rule.list_price_markup_pct} onChange={(e) => setR("list_price_markup_pct", Number(e.target.value))} className={`${inp} w-20`} title="İndirimli görünüm için üstü çizili liste fiyatı" /></label>
          <label className="flex items-center gap-1 pb-2"><input type="checkbox" checked={rule.include_service_fee} onChange={(e) => setR("include_service_fee", e.target.checked)} /> Hizmet bedeli dahil</label>
          <label className="flex items-center gap-1 pb-2"><input type="checkbox" checked={rule.include_cargo} onChange={(e) => setR("include_cargo", e.target.checked)} /> Kargo bedeli dahil</label>
          <button onClick={() => compute(rule)} disabled={busy === "compute"} className="px-3 py-2 border border-slate-200 bg-white rounded-lg font-semibold flex items-center gap-1" data-testid="rule-recalc">{busy === "compute" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calculator className="w-3.5 h-3.5" />} Hesapla</button>
          <button onClick={saveRule} disabled={busy === "save"} className="px-3 py-2 bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-1" data-testid="rule-save"><Save className="w-3.5 h-3.5" /> Kuralı Kaydet</button>
          {data && <span className="text-[10px] text-slate-500 pb-2 ml-auto">Komisyon %{data.fees.commission_rate} (+%{data.fees.commission_vat_rate} KDV) · hizmet {fmt(data.fees.service_fee)} ₺ · kargo {fmt(data.fees.cargo_fee)} ₺ — Kârlılık sekmesinden değiştirilebilir</span>}
        </div>)}
      {data && (<>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{data.priced} fiyatlanabilir</span>{data.no_cost > 0 && <span className="text-amber-700 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {data.no_cost} üründe alış fiyatı yok (stok kartına girin)</span>}
          <label className="flex items-center gap-1 ml-2"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} data-testid="pricing-only-diff" /> Sadece farklı olanlar</label>
          <button onClick={() => setSel(rows.filter((r) => r.suggested).map((r) => r.barcode))} className="px-2 py-1 border rounded-lg" data-testid="pricing-select-all">Tümünü seç</button>
          {data.push_supported ? <button onClick={push} disabled={!sel.length || busy === "push"} className="ml-auto px-4 py-2 bg-amber-500 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="pricing-push"><Upload className="w-3.5 h-3.5" /> Seçili {sel.length} Fiyatı Gönder</button> : <span className="ml-auto text-slate-400">Bu kanal salt-okunur (XML) — fiyatlar yalnızca öneri</span>}
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-left"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2 w-8"><input type="checkbox" checked={rows.length > 0 && sel.length === rows.filter((r) => r.suggested).length} onChange={(e) => setSel(e.target.checked ? rows.filter((r) => r.suggested).map((r) => r.barcode) : [])} /></th><th className="px-3 py-2">Ürün</th><th className="px-3 py-2 text-right">Maliyet</th><th className="px-3 py-2 text-right">Mevcut Fiyat</th><th className="px-3 py-2 text-right">Mevcut Net Kâr</th><th className="px-3 py-2 text-right">Önerilen</th><th className="px-3 py-2 text-right">Fark</th><th className="px-3 py-2 text-right">Yeni Net Kâr</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-400">Eşleşmiş ürün yok — Ürünler & Fiyat sekmesinden stok kartlarını eşleştirin.</td></tr>}{rows.map((r) => (
              <tr key={r.barcode} className={!r.suggested ? "opacity-50" : ""} data-testid={`pricing-row-${r.barcode}`}>
                <td className="px-3 py-1.5"><input type="checkbox" disabled={!r.suggested} checked={sel.includes(r.barcode)} onChange={() => setSel(sel.includes(r.barcode) ? sel.filter((x) => x !== r.barcode) : [...sel, r.barcode])} data-testid={`pricing-select-${r.barcode}`} /></td>
                <td className="px-3 py-1.5"><div className="flex items-center gap-2">{r.image && <img src={r.image} alt="" className="w-8 h-8 rounded object-cover border" />}<div><div className="font-semibold text-slate-900 line-clamp-1 max-w-xs">{r.title}</div><div className="text-[10px] text-slate-400">{r.product_sku} · {r.barcode}</div></div></div></td>
                <td className="px-3 py-1.5 text-right">{r.cost ? `${fmt(r.cost)} ₺` : <span className="text-amber-600">{r.reason}</span>}</td>
                <td className="px-3 py-1.5 text-right font-semibold">{fmt(r.sale_price)} ₺</td>
                <td className={`px-3 py-1.5 text-right ${r.current_net < 0 ? "text-rose-600 font-bold" : ""}`}>{r.cost ? `${fmt(r.current_net)} ₺` : "—"}</td>
                <td className="px-3 py-1.5 text-right font-bold text-emerald-700">{r.suggested ? `${fmt(r.suggested)} ₺` : "—"}</td>
                <td className={`px-3 py-1.5 text-right ${r.diff > 0 ? "text-emerald-700" : r.diff < 0 ? "text-rose-600" : ""}`}>{r.suggested ? `${r.diff > 0 ? "+" : ""}${fmt(r.diff)} (${r.diff_pct > 0 ? "+" : ""}${r.diff_pct}%)` : "—"}</td>
                <td className="px-3 py-1.5 text-right">{r.suggested ? `${fmt(r.net_profit)} ₺ (%${r.margin_pct})` : "—"}</td>
              </tr>))}</tbody></table>
        </div>
      </>)}
    </div>
  );
};

export const MorningSummarySettings = ({ companyId }) => {
  const [st, setSt] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => axios.get(`${API_URL}/reports/morning-summary/settings?company_id=${companyId}`).then((r) => setSt(r.data)).catch(() => {}), [companyId]);
  useEffect(() => { load(); }, [load]);
  const save = async () => { setBusy("save"); try { const r = await axios.put(`${API_URL}/reports/morning-summary/settings`, { company_id: companyId, ...st }); setSt(r.data); toast.success("Sabah özeti ayarları kaydedildi."); } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(""); } };
  const doPreview = async () => { setBusy("preview"); try { const r = await axios.get(`${API_URL}/reports/morning-summary/preview?company_id=${companyId}`); setPreview(r.data.text); } catch (e) { toast.error("Önizleme alınamadı."); } finally { setBusy(""); } };
  const sendNow = async () => { setBusy("send"); try { await save(); const r = await axios.post(`${API_URL}/reports/morning-summary/send`, { company_id: companyId }); (r.data.status === "success" ? toast.success : toast.error)(r.data.message); setPreview(r.data.text); load(); } catch (e) { toast.error(e.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(""); } };
  if (!st) return null;
  const lr = st.last_result;
  return (
    <div className="space-y-3 text-xs" data-testid="morning-summary-settings">
      <div><h2 className="text-base font-bold text-slate-900">Sabah Özeti</h2><p className="text-slate-500">Her sabah yeni siparişler (kanal bazlı), kargo bekleyenler, kritik stok, vadesi geçen alacaklar ve açık iadeler e-posta / WhatsApp ile gönderilir. E-posta için İletişim → E-posta hesabı (SMTP), WhatsApp için WhatsApp ayarları tanımlı olmalıdır.</p></div>
      <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={st.enabled} onChange={(e) => setSt({ ...st, enabled: e.target.checked })} data-testid="ms-enabled" /> Otomatik gönderim açık</label>
        <label>Gönderim saati (TR) <input type="time" value={st.time} onChange={(e) => setSt({ ...st, time: e.target.value })} className={`${inp} ml-2`} data-testid="ms-time" /></label>
        <label>E-posta alıcıları (virgülle)<br /><input value={(st.emails || []).join(", ")} onChange={(e) => setSt({ ...st, emails: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="patron@firma.com, muhasebe@firma.com" className={`${inp} w-full`} data-testid="ms-emails" /></label>
        <label>WhatsApp numaraları (virgülle)<br /><input value={(st.whatsapp_numbers || []).join(", ")} onChange={(e) => setSt({ ...st, whatsapp_numbers: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="05xx xxx xx xx" className={`${inp} w-full`} data-testid="ms-whatsapp" /></label>
        <div className="md:col-span-2 flex flex-wrap gap-2">
          <button onClick={save} disabled={busy === "save"} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold" data-testid="ms-save">Kaydet</button>
          <button onClick={doPreview} disabled={busy === "preview"} className="px-4 py-2 border rounded-lg font-semibold" data-testid="ms-preview">Önizle</button>
          <button onClick={sendNow} disabled={busy === "send"} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="ms-send">Şimdi Gönder</button>
          {st.last_sent && <span className="self-center text-slate-500" data-testid="ms-last">Son gönderim: {new Date(st.last_sent).toLocaleString("tr-TR")} {lr?.email ? (lr.email.ok ? "· e-posta ✓" : `· e-posta ✗ ${lr.email.error}`) : ""} {lr?.whatsapp ? `· WhatsApp ${lr.whatsapp.filter((w) => w.ok).length}/${lr.whatsapp.length}` : ""}</span>}
        </div>
      </div>
      {preview && <pre className="bg-slate-900 text-slate-100 rounded-2xl p-4 whitespace-pre-wrap text-xs" data-testid="ms-preview-text">{preview}</pre>}
    </div>
  );
};
