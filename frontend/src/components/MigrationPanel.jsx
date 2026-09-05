import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Upload, Download, Loader2, RotateCcw, CheckCircle2, AlertTriangle, Plug, FileSpreadsheet, ArrowRight, Sparkles } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const inp = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";
const dl = (url, name) => axios.get(url, { responseType: "blob" }).then((r) => { const a = document.createElement("a"); a.href = URL.createObjectURL(r.data); a.download = name; a.click(); }).catch(() => toast.error("İndirilemedi."));

const BizimHesapCard = ({ companyId, onImported }) => {
  const [cfg, setCfg] = useState(null);
  const [token, setToken] = useState("");
  const [firmId, setFirmId] = useState("");
  const [test, setTest] = useState(null);
  const [wh, setWh] = useState("");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => axios.get(`${API_URL}/migration/bizimhesap/config?company_id=${companyId}`).then((r) => { setCfg(r.data); setFirmId(r.data.firm_id || ""); }).catch(() => {}), [companyId]);
  useEffect(() => { load(); }, [load]);
  const save = async () => { setBusy("save"); try { await axios.put(`${API_URL}/migration/bizimhesap/config`, { company_id: companyId, token, firm_id: firmId }); toast.success("BizimHesap bağlantı bilgileri kaydedildi."); setToken(""); load(); } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(""); } };
  const runTest = async () => { setBusy("test"); try { const r = await axios.post(`${API_URL}/migration/bizimhesap/test`, { company_id: companyId }); setTest(r.data); if (r.data.warehouses?.[0]) setWh(r.data.warehouses[0].id); toast.success(`Bağlantı başarılı: ${r.data.product_count} ürün, ${r.data.warehouses.length} depo.`); } catch (e) { toast.error(e.response?.data?.detail || "Bağlantı testi başarısız."); } finally { setBusy(""); } };
  const [custOpt, setCustOpt] = useState({ only_with_balance: false, invert_sign: false });
  const importCustomers = async () => { if (!window.confirm("BizimHesap carileri (ünvan, VKN, iletişim, bakiye) aktarılsın mı? Mevcut cariler VKN/ünvan eşleşmesiyle güncellenir; işlem Aktarım Günlüğü'nden geri alınabilir.")) return; setBusy("cust"); try { const r = await axios.post(`${API_URL}/migration/bizimhesap/import-customers`, { company_id: companyId, ...custOpt, on_duplicate: "update" }); toast.success(r.data.message); load(); onImported(); } catch (e) { toast.error(e.response?.data?.detail || "Cari aktarımı başarısız."); } finally { setBusy(""); } };
  const doImport = async () => { if (!window.confirm("BizimHesap ürünleri stok kartlarına aktarılsın mı? Mevcut (barkod/SKU eşleşen) kartlar güncellenir.")) return; setBusy("import"); try { const r = await axios.post(`${API_URL}/migration/bizimhesap/import`, { company_id: companyId, with_stock: !!wh, warehouse_id: wh || null, on_duplicate: "update" }); toast.success(r.data.message); load(); onImported(); } catch (e) { toast.error(e.response?.data?.detail || "Aktarım başarısız."); } finally { setBusy(""); } };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 text-xs" data-testid="bizimhesap-card">
      <div className="flex items-center justify-between"><b className="text-sm text-slate-900 flex items-center gap-2"><Plug className="w-4 h-4 text-emerald-600" /> BizimHesap API Bağlantısı</b>{cfg?.configured && <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold" data-testid="bh-configured">Token kayıtlı {cfg.token_mask}</span>}</div>
      <p className="text-slate-500">BizimHesap resmi API'si <b>ürün, depo ve depo stoklarını</b> okumayı destekler; cari/fatura/ödeme listeleri için aşağıdaki Excel aktarımını kullanın (BizimHesap → Raporlar → Excel'e aktar).</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cfg?.configured ? "Yeni token (değiştirmek için)" : "BizimHesap Token"} className={inp} data-testid="bh-token" />
        <input value={firmId} onChange={(e) => setFirmId(e.target.value)} placeholder="Firma ID (opsiyonel)" className={inp} data-testid="bh-firm" />
        <div className="flex gap-2"><button onClick={save} disabled={busy === "save" || (!token && !cfg?.configured)} className="px-3 py-2 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="bh-save">Kaydet</button><button onClick={runTest} disabled={!cfg?.configured || busy === "test"} className="px-3 py-2 border border-slate-200 rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="bh-test">{busy === "test" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />} Bağlantıyı Test Et</button></div>
      </div>
      {test && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2" data-testid="bh-test-result">
          <div className="flex flex-wrap items-center gap-3"><CheckCircle2 className="w-4 h-4 text-emerald-600" /><b>{test.product_count} ürün</b><span>{test.warehouses.length} depo</span><span className="text-slate-500">Alanlar: {test.product_fields.slice(0, 12).join(", ")}{test.product_fields.length > 12 ? "…" : ""}</span></div>
          <div className="flex flex-wrap items-center gap-2"><label>Stok miktarı deposu:</label><select value={wh} onChange={(e) => setWh(e.target.value)} className="bg-white border rounded-lg p-1.5" data-testid="bh-warehouse"><option value="">Stok alma</option>{test.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            <button onClick={doImport} disabled={busy === "import"} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="bh-import">{busy === "import" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Ürünleri Aktar</button></div>
        </div>)}
      {cfg?.configured && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-3" data-testid="bh-customers">
          <b className="text-slate-800">Cariler & Bakiyeler</b>
          <label className="flex items-center gap-1"><input type="checkbox" checked={custOpt.only_with_balance} onChange={(e) => setCustOpt({ ...custOpt, only_with_balance: e.target.checked })} data-testid="bh-cust-onlybal" /> Sadece bakiyesi olanlar</label>
          <label className="flex items-center gap-1" title="BizimHesap'ta bakiye işareti ters görünüyorsa"><input type="checkbox" checked={custOpt.invert_sign} onChange={(e) => setCustOpt({ ...custOpt, invert_sign: e.target.checked })} data-testid="bh-cust-invert" /> Bakiye işaretini ters çevir</label>
          <button onClick={importCustomers} disabled={busy === "cust"} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="bh-import-customers">{busy === "cust" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Carileri Aktar</button>
          {cfg?.last_customer_import && <span className="text-[10px] text-slate-400">Son: {new Date(cfg.last_customer_import.at).toLocaleString("tr-TR")} · {cfg.last_customer_import.inserted} yeni / {cfg.last_customer_import.updated} güncel · toplam bakiye {Number(cfg.last_customer_import.total_balance).toLocaleString("tr-TR")} ₺</span>}
        </div>)}
      {cfg?.last_import && <div className="text-[10px] text-slate-400">Son aktarım: {new Date(cfg.last_import.at).toLocaleString("tr-TR")} · {cfg.last_import.inserted} yeni, {cfg.last_import.updated} güncellendi</div>}
    </div>
  );
};

const ExcelWizard = ({ companyId, meta, onImported }) => {
  const [entity, setEntity] = useState("contacts");
  const [source, setSource] = useState("bizimhesap");
  const [parsed, setParsed] = useState(null);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [onDup, setOnDup] = useState("skip");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const ent = meta.entities.find((e) => e.key === entity);
  const upload = async (file) => {
    if (!file) return;
    setBusy("parse"); setPreview(null); setResult(null);
    const fd = new FormData(); fd.append("file", file); fd.append("entity", entity); fd.append("source", source); fd.append("company_id", companyId);
    try { const r = await axios.post(`${API_URL}/migration/parse`, fd); setParsed(r.data); setMapping(r.data.suggested_mapping); toast.success(`${r.data.row_count} satır okundu; ${Object.values(r.data.suggested_mapping).filter(Boolean).length} sütun otomatik eşlendi.`); }
    catch (e) { toast.error(e.response?.data?.detail || "Dosya okunamadı."); } finally { setBusy(""); }
  };
  const [aiNote, setAiNote] = useState("");
  const aiMap = async () => { setBusy("ai"); try { const r = await axios.post(`${API_URL}/migration/ai-map`, { upload_id: parsed.upload_id }); setMapping(r.data.mapping); setAiNote(r.data.notes); toast.success(`AI ${r.data.mapped} alanı eşledi.`); } catch (e) { toast.error(e.response?.data?.detail || "AI eşleme başarısız."); } finally { setBusy(""); } };
  const doPreview = async () => { setBusy("preview"); try { const r = await axios.post(`${API_URL}/migration/preview`, { upload_id: parsed.upload_id, mapping }); setPreview(r.data); } catch (e) { toast.error(e.response?.data?.detail || "Önizleme başarısız."); } finally { setBusy(""); } };
  const doImport = async () => { setBusy("import"); try { const r = await axios.post(`${API_URL}/migration/import`, { upload_id: parsed.upload_id, mapping, on_duplicate: onDup }); setResult(r.data); toast.success(r.data.message); onImported(); } catch (e) { toast.error(e.response?.data?.detail || "Aktarım başarısız."); } finally { setBusy(""); } };
  const reset = () => { setParsed(null); setPreview(null); setResult(null); setMapping({}); setAiNote(""); };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4 text-xs" data-testid="excel-wizard">
      <div className="flex items-center justify-between"><b className="text-sm text-slate-900 flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel / CSV ile Veri Aktarımı</b><span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-2 py-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Yapay zekâ destekli: farklı sistemlerin Excel başlıklarını AI eşler</span></div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div><label className="block font-semibold mb-1">Kaynak sistem</label><select value={source} onChange={(e) => setSource(e.target.value)} disabled={!!parsed} className={inp} data-testid="mig-source">{meta.sources.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
        <div><label className="block font-semibold mb-1">Veri türü</label><select value={entity} onChange={(e) => { setEntity(e.target.value); reset(); }} disabled={!!parsed} className={inp} data-testid="mig-entity">{meta.entities.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</select></div>
        <div className="md:col-span-2 flex items-end gap-2"><button onClick={() => dl(`${API_URL}/migration/template/${entity}`, `sablon_${entity}.xlsx`)} className="px-3 py-2 border border-slate-200 rounded-lg font-semibold flex items-center gap-1" data-testid="mig-template"><Download className="w-3.5 h-3.5" /> Şablon Excel İndir</button>{parsed && <button onClick={reset} className="px-3 py-2 border rounded-lg" data-testid="mig-reset">Yeni dosya</button>}</div>
      </div>
      {!parsed && (
        <label className="block border-2 border-dashed border-emerald-200 bg-emerald-50/40 rounded-2xl p-8 text-center cursor-pointer hover:bg-emerald-50" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }} data-testid="mig-dropzone">
          <input type="file" accept=".xlsx,.xlsm,.csv,.txt" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="mig-file" />
          {busy === "parse" ? <Loader2 className="w-8 h-8 mx-auto animate-spin text-emerald-500" /> : <Upload className="w-8 h-8 mx-auto text-emerald-400" />}
          <div className="mt-2 font-semibold text-slate-800">{ent?.label} dosyasını sürükleyin veya seçin (.xlsx / .csv)</div>
          <div className="text-slate-500 mt-1">Başlık satırı otomatik bulunur, sütunlar {meta.sources.find((s) => s.code === source)?.name} formatına göre eşlenir.</div>
        </label>)}
      {parsed && !result && (<>
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 font-semibold flex items-center justify-between gap-2"><span>Sütun eşleme — {parsed.filename} · {parsed.row_count} satır</span><div className="flex items-center gap-2"><button type="button" onClick={aiMap} disabled={busy === "ai"} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="mig-ai-map"> {busy === "ai" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} AI ile Eşle</button><span className="text-slate-400">* zorunlu</span></div></div>
          {aiNote && <div className="px-3 py-1.5 bg-purple-50 text-purple-900 text-[11px] border-b border-purple-100" data-testid="mig-ai-note"><Sparkles className="w-3 h-3 inline mr-1" />{aiNote}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 p-3">{parsed.fields.map((f) => (
            <div key={f.key} className="flex items-center gap-2 py-0.5" data-testid={`mig-map-${f.key}`}><span className={`w-48 shrink-0 ${f.required ? "font-bold text-slate-900" : "text-slate-600"}`}>{f.label}{f.required ? " *" : ""}</span><ArrowRight className="w-3 h-3 text-slate-300" />
              <select value={mapping[f.key] || ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value || null })} className={`${inp} ${f.required && !mapping[f.key] ? "border-rose-300 bg-rose-50" : mapping[f.key] ? "border-emerald-200" : ""}`} data-testid={`mig-map-select-${f.key}`}><option value="">— eşleme yok —</option>{parsed.columns.map((c) => <option key={c} value={c}>{c}{parsed.sample[0]?.[c] != null ? `  (örn: ${String(parsed.sample[0][c]).slice(0, 25)})` : ""}</option>)}</select></div>))}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={doPreview} disabled={busy === "preview"} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="mig-preview-btn">{busy === "preview" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Önizle & Doğrula</button>
          <label className="flex items-center gap-1 ml-2">Mevcut kayıt varsa:<select value={onDup} onChange={(e) => setOnDup(e.target.value)} className="bg-white border rounded-lg p-1.5" data-testid="mig-ondup"><option value="skip">Atla</option><option value="update">Güncelle (bakiye/stok hariç)</option></select></label>
        </div>
        {preview && (
          <div className="space-y-2" data-testid="mig-preview">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">{[["Toplam", preview.total, ""], ["Geçerli", preview.valid, "text-emerald-700"], ["Yeni", preview.new, "text-sky-700"], ["Mevcut", preview.existing, "text-amber-700"], ["Hatalı", preview.invalid, "text-rose-700"]].map(([l, v, c]) => <div key={l} className="bg-slate-50 rounded-xl p-2 text-center"><div className="text-[10px] uppercase text-slate-400 font-semibold">{l}</div><div className={`text-base font-bold ${c || "text-slate-900"}`} data-testid={`mig-stat-${l.toLowerCase()}`}>{v}</div></div>)}</div>
            {preview.errors.length > 0 && <div className="bg-rose-50 border border-rose-200 rounded-xl p-2 max-h-40 overflow-y-auto" data-testid="mig-errors"><div className="font-bold text-rose-800 flex items-center gap-1 mb-1"><AlertTriangle className="w-3.5 h-3.5" /> Hatalı satırlar (aktarılmaz)</div>{preview.errors.map((e) => <div key={e.row}>Satır {e.row} · {e.label}: {e.errors.join(", ")}</div>)}</div>}
            <div className="overflow-x-auto border border-slate-200 rounded-xl"><table className="w-full"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-2 py-1.5 text-left">Satır</th><th className="px-2 py-1.5 text-left">Kayıt</th><th className="px-2 py-1.5 text-left">Durum</th><th className="px-2 py-1.5 text-left">Alanlar</th></tr></thead><tbody className="divide-y divide-slate-100">{preview.sample.map((r) => <tr key={r.row}><td className="px-2 py-1">{r.row}</td><td className="px-2 py-1 font-semibold">{r.label}</td><td className="px-2 py-1"><span className={`px-1.5 py-0.5 rounded font-semibold ${r.status === "hata" ? "bg-rose-50 text-rose-700" : r.status === "yeni" ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700"}`}>{r.status}</span></td><td className="px-2 py-1 text-slate-500 truncate max-w-lg">{Object.entries(r.data).filter(([k]) => !["name", "account_name", "full_name"].includes(k)).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td></tr>)}</tbody></table></div>
            <button onClick={doImport} disabled={busy === "import" || !preview.valid} className="px-5 py-2 bg-emerald-600 text-white rounded-lg font-semibold flex items-center gap-1 disabled:opacity-50" data-testid="mig-import-btn">{busy === "import" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} {preview.valid} kaydı içe aktar</button>
          </div>)}
      </>)}
      {result && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center gap-3" data-testid="mig-result"><CheckCircle2 className="w-5 h-5 text-emerald-600" /><b>{result.message}</b><button onClick={reset} className="ml-auto px-3 py-1.5 border border-emerald-300 rounded-lg font-semibold" data-testid="mig-another">Yeni aktarım</button></div>}
    </div>
  );
};

export const MigrationPanel = ({ companyId }) => {
  const [meta, setMeta] = useState(null);
  const [batches, setBatches] = useState([]);
  const loadBatches = useCallback(() => axios.get(`${API_URL}/migration/batches?company_id=${companyId}`).then((r) => setBatches(r.data)).catch(() => {}), [companyId]);
  useEffect(() => { axios.get(`${API_URL}/migration/sources`).then((r) => setMeta(r.data)).catch(() => toast.error("Aktarım ayarları yüklenemedi.")); loadBatches(); }, [loadBatches]);
  const rollback = async (b) => { if (!window.confirm(`"${b.filename}" aktarımı geri alınsın mı? Eklenen ${b.inserted} kayıt silinir, ${b.updated} güncelleme eski haline döner.`)) return; try { const r = await axios.post(`${API_URL}/migration/batches/${b.id}/rollback`); toast.success(r.data.message); loadBatches(); } catch (e) { toast.error(e.response?.data?.detail || "Geri alınamadı."); } };
  if (!meta) return <div className="p-6 text-xs text-slate-400">Yükleniyor…</div>;
  return (
    <div className="space-y-4" data-testid="migration-panel">
      <div><h2 className="text-base font-bold text-slate-900">Veri Aktarım Merkezi</h2><p className="text-xs text-slate-500">Başka bir ön muhasebe / ERP sisteminden (BizimHesap, Paraşüt, Logo İşbaşı, Mikro, OVOCRM, Netesnaf…) carilerinizi, ürünlerinizi, faturalarınızı, hesap bakiyelerinizi ve personelinizi taşıyın. Her aktarım kayıt altına alınır ve tek tıkla geri alınabilir.</p></div>
      <BizimHesapCard companyId={companyId} onImported={loadBatches} />
      <ExcelWizard companyId={companyId} meta={meta} onImported={loadBatches} />
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden text-xs" data-testid="migration-batches">
        <div className="px-4 py-3 border-b font-bold text-sm text-slate-900">Aktarım Günlüğü</div>
        <table className="w-full"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Tarih</th><th className="px-3 py-2 text-left">Veri</th><th className="px-3 py-2 text-left">Kaynak / Dosya</th><th className="px-3 py-2 text-right">Yeni</th><th className="px-3 py-2 text-right">Güncel</th><th className="px-3 py-2 text-right">Atlanan</th><th className="px-3 py-2 text-right">Hatalı</th><th className="px-3 py-2 text-center">İşlem</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{batches.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">Henüz aktarım yapılmadı.</td></tr>}{batches.map((b) => (
            <tr key={b.id} className={b.status === "rolled_back" ? "opacity-50" : ""} data-testid={`mig-batch-${b.id}`}><td className="px-3 py-2 whitespace-nowrap">{new Date(b.created_at).toLocaleString("tr-TR")}</td><td className="px-3 py-2 font-semibold">{b.entity_label}</td><td className="px-3 py-2">{b.source} · {b.filename}</td><td className="px-3 py-2 text-right text-sky-700 font-bold">{b.inserted}</td><td className="px-3 py-2 text-right">{b.updated}</td><td className="px-3 py-2 text-right">{b.skipped}</td><td className="px-3 py-2 text-right text-rose-600">{b.failed}</td>
              <td className="px-3 py-2"><div className="flex items-center justify-center gap-1">{b.error_count > 0 && <button onClick={() => dl(`${API_URL}/migration/batches/${b.id}/errors.csv`, `hatalar_${b.id.slice(0, 8)}.csv`)} className="px-2 py-1 border rounded-lg" data-testid={`mig-errors-${b.id}`}>Hata CSV</button>}{b.status === "rolled_back" ? <span className="text-slate-400">Geri alındı</span> : <button onClick={() => rollback(b)} className="px-2 py-1 border border-rose-200 text-rose-600 rounded-lg font-semibold flex items-center gap-1" data-testid={`mig-rollback-${b.id}`}><RotateCcw className="w-3 h-3" /> Geri Al</button>}</div></td></tr>))}</tbody></table>
      </div>
    </div>
  );
};
