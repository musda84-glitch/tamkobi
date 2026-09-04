import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plug, RefreshCw, Plus, X, Trash2, CheckCircle2, AlertCircle, FlaskConical, Link2, Loader2, Wand2, Settings2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";
const FIELD_LABELS = { client_id: "Client ID", client_secret: "Client Secret", api_key: "API Key", customer_number: "Müşteri Numarası", base_url: "API Base URL" };

const StatusBadge = ({ status }) => {
  const map = {
    connected: ["bg-emerald-50 text-emerald-700 border-emerald-200", "CANLI BAĞLI", CheckCircle2],
    simulated: ["bg-amber-50 text-amber-700 border-amber-200", "SİMÜLE", FlaskConical],
    error: ["bg-rose-50 text-rose-700 border-rose-200", "HATA", AlertCircle],
    disconnected: ["bg-slate-100 text-slate-600 border-slate-200", "BAĞLI DEĞİL", Plug]
  };
  const [cls, label, Icon] = map[status] || map.disconnected;
  return <span className={`inline-flex items-center gap-1 border rounded-md px-2 py-0.5 text-[10px] font-bold ${cls}`} data-testid={`conn-status-${status}`}><Icon className="w-3 h-3" /> {label}</span>;
};

export const BankConnectionsPanel = ({ companyId, accounts, contacts, onSynced }) => {
  const [providers, setProviders] = useState([]);
  const [connections, setConnections] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [busy, setBusy] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ provider: "kuveytturk", linked_account_id: "", mode: "sandbox", client_id: "", client_secret: "", api_key: "", customer_number: "", bank_account_number: "", base_url: "", auto_sync: true });
  const [matchSel, setMatchSel] = useState({});
  const [rules, setRules] = useState([]);
  const [showRules, setShowRules] = useState(false);
  const [newRule, setNewRule] = useState({ pattern: "", contact_id: "", category: "" });

  const load = useCallback(async () => {
    try {
      const [p, c, u, r] = await Promise.all([
        axios.get(`${API_URL}/banking/providers`),
        axios.get(`${API_URL}/banking/connections?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/transactions/unmatched?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/match-rules?company_id=${companyId}`)
      ]);
      setProviders(p.data); setConnections(c.data); setUnmatched(u.data); setRules(r.data);
      const init = {};
      u.data.forEach((t) => { if (t.suggested_contact_id) init[t.id] = t.suggested_contact_id; });
      setMatchSel(init);
    } catch { toast.error("Banka bağlantıları yüklenemedi."); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const provider = providers.find((p) => p.code === form.provider);

  const save = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/banking/connections`, { company_id: companyId, provider_name: "", ...form, linked_account_id: form.linked_account_id || accounts[0]?.id });
      toast[res.data.test_result?.ok ? "success" : "error"](res.data.test_result?.message);
      setShowAdd(false); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Bağlantı eklenemedi."); }
  };

  const testConn = async (id) => {
    setBusy(id + "-test");
    try { const r = await axios.post(`${API_URL}/banking/connections/${id}/test`); toast[r.data.ok ? "success" : "error"](r.data.message); load(); }
    catch { toast.error("Test başarısız."); } finally { setBusy(null); }
  };

  const sync = async (id) => {
    setBusy(id + "-sync");
    try { const r = await axios.post(`${API_URL}/banking/connections/${id}/sync`); toast.success(r.data.message); load(); onSynced?.(); }
    catch (err) { toast.error(err.response?.data?.detail || "Senkronizasyon başarısız."); } finally { setBusy(null); }
  };

  const syncAll = async () => {
    setBusy("all");
    try { const r = await axios.post(`${API_URL}/banking/sync-all?company_id=${companyId}`); toast.success(`${r.data.results.length} bağlantı senkronize edildi.`); load(); onSynced?.(); }
    catch { toast.error("Toplu senkronizasyon başarısız."); } finally { setBusy(null); }
  };

  const remove = async (id) => {
    try { await axios.delete(`${API_URL}/banking/connections/${id}`); toast.success("Bağlantı kaldırıldı."); load(); } catch { toast.error("Silinemedi."); }
  };

  const match = async (tx) => {
    try {
      await axios.post(`${API_URL}/banking/transactions/${tx.id}/match`, { contact_id: matchSel[tx.id] || null });
      toast.success("Hareket eşleştirildi ve kural olarak öğrenildi."); load(); onSynced?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Eşleştirilemedi."); }
  };

  const autoMatch = async (useSuggestions) => {
    setBusy("auto");
    try {
      const r = await axios.post(`${API_URL}/banking/transactions/auto-match?company_id=${companyId}&use_suggestions=${useSuggestions}`);
      toast[r.data.matched > 0 ? "success" : "info"](r.data.message); load(); onSynced?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Otomatik eşleştirme başarısız."); } finally { setBusy(null); }
  };

  const addRule = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/banking/match-rules`, { company_id: companyId, ...newRule, contact_id: newRule.contact_id || null, category: newRule.category || null });
      toast.success("Kural eklendi."); setNewRule({ pattern: "", contact_id: "", category: "" }); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Kural eklenemedi."); }
  };

  const deleteRule = async (id) => {
    try { await axios.delete(`${API_URL}/banking/match-rules/${id}`); load(); } catch { toast.error("Kural silinemedi."); }
  };

  return (
    <div className="space-y-5" data-testid="bank-connections-panel">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-blue-50 text-blue-600"><Link2 className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Banka Entegrasyonu — Canlı Veri</h2>
            <p className="text-xs text-slate-500">Açık bankacılık API'si ile hesap hareketlerini otomatik çekin, cari/fatura ile eşleştirin</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={syncAll} disabled={busy === "all" || !connections.length} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-50" data-testid="sync-all-btn">{busy === "all" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Tümünü Senkronize Et</button>
          <button onClick={() => { setForm({ ...form, linked_account_id: accounts[0]?.id || "" }); setShowAdd(true); }} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="add-bank-connection-btn"><Plus className="w-4 h-4" /> Banka Bağla</button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800" data-testid="bank-sim-notice">
        <b>Not:</b> API kimlik bilgisi (Client ID/Secret) girilmeyen bağlantılar <b>SİMÜLE</b> modda çalışır ve örnek hareket üretir. Kuveyt Türk API Market (developer.kuveytturk.com.tr) veya QNB/Enpara Developer Portal (developer.qnb.com.tr) üzerinden aldığınız kurumsal anahtarları girdiğinizde aynı ekrandan canlı veri çekilir.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {connections.map((c) => (
          <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm" data-testid={`bank-conn-card-${c.provider}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-slate-900 text-sm">{c.provider_name}</div>
                <div className="text-[11px] text-slate-500">→ {c.linked_account_name}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={c.status} />
                <span className="text-[10px] font-mono text-slate-400 uppercase">{c.mode}</span>
              </div>
            </div>
            <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4">
              <span>Son senk: <b className="text-slate-700">{c.last_synced_at ? new Date(c.last_synced_at).toLocaleString("tr-TR") : "—"}</b></span>
              <span>Çekilen: <b className="text-slate-700">{c.synced_count}</b></span>
              {c.client_id ? <span>Client: <b className="font-mono">{c.client_id}</b></span> : <span className="text-amber-600 font-semibold">Anahtar girilmedi</span>}
            </div>
            {c.last_error && <div className="text-[11px] text-rose-600 bg-rose-50 rounded-lg p-2">{c.last_error}</div>}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <button onClick={() => sync(c.id)} disabled={!!busy} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50" data-testid={`sync-conn-btn-${c.provider}`}>{busy === c.id + "-sync" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Hareketleri Çek</button>
              <button onClick={() => testConn(c.id)} disabled={!!busy} className="px-3 py-1.5 border rounded-lg text-[11px] font-semibold hover:bg-slate-50" data-testid={`test-conn-btn-${c.provider}`}>Bağlantıyı Test Et</button>
              <button onClick={() => remove(c.id)} className="ml-auto p-1.5 text-slate-300 hover:text-rose-600" data-testid={`delete-conn-btn-${c.provider}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
        {connections.length === 0 && <div className="col-span-full text-center text-xs text-slate-400 py-8 bg-white border border-dashed rounded-2xl">Henüz banka bağlantısı yok. "Banka Bağla" ile Kuveyt Türk, Enpara/QNB veya Finfree bağlayın.</div>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-sm font-bold text-slate-900">Eşleştirme Bekleyen Banka Hareketleri</span>
            <span className="ml-2 text-xs text-slate-400">{unmatched.length} hareket</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => autoMatch(false)} disabled={!!busy || !unmatched.length} className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-[11px] font-semibold hover:bg-violet-700 disabled:opacity-50" title="Daha önce eşleştirdiğiniz açıklamalara göre otomatik işle" data-testid="auto-match-btn">
              {busy === "auto" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Önceki Eşleşmelerle Otomatik İşle
            </button>
            <button onClick={() => autoMatch(true)} disabled={!!busy || !unmatched.length} className="px-3 py-1.5 border border-violet-200 text-violet-700 rounded-lg text-[11px] font-semibold hover:bg-violet-50 disabled:opacity-50" title="Kurallar + isim benzerliği önerilerini de uygula" data-testid="auto-match-suggestions-btn">+ Önerileri de Uygula</button>
            <button onClick={() => setShowRules(!showRules)} className="flex items-center gap-1 px-3 py-1.5 border rounded-lg text-[11px] font-semibold hover:bg-slate-50" data-testid="toggle-rules-btn"><Settings2 className="w-3.5 h-3.5" /> Kurallar ({rules.length})</button>
          </div>
        </div>
        {showRules && (
          <div className="px-5 py-3 bg-violet-50/40 border-b border-violet-100 space-y-2 text-xs" data-testid="match-rules-panel">
            <p className="text-[11px] text-slate-500">Her manuel eşleştirme otomatik kural olarak öğrenilir. İsterseniz anahtar kelime → cari/kategori kuralı da ekleyebilirsiniz.</p>
            <form onSubmit={addRule} className="flex flex-wrap gap-2 items-center">
              <input value={newRule.pattern} onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })} placeholder="Anahtar kelime (örn: trendyol)" className="bg-white border border-slate-200 rounded-lg p-1.5 w-48" required data-testid="rule-pattern-input" />
              <select value={newRule.contact_id} onChange={(e) => setNewRule({ ...newRule, contact_id: e.target.value })} className="bg-white border border-slate-200 rounded-lg p-1.5 w-44" data-testid="rule-contact-select"><option value="">Cari (opsiyonel)</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <input value={newRule.category} onChange={(e) => setNewRule({ ...newRule, category: e.target.value })} placeholder="Kategori (örn: Pazaryeri Hakediş)" className="bg-white border border-slate-200 rounded-lg p-1.5 w-48" data-testid="rule-category-input" />
              <button type="submit" className="px-3 py-1.5 bg-violet-600 text-white rounded-lg font-semibold" data-testid="add-rule-btn">Kural Ekle</button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {rules.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 bg-white border border-violet-200 rounded-md px-2 py-1 text-[11px]" data-testid={`rule-chip-${r.id}`}>
                  <b className="font-mono text-violet-800">"{r.pattern}"</b> → {r.contact_name || r.category || "—"} <span className="text-slate-400">({r.hits}x)</span>
                  <button onClick={() => deleteRule(r.id)} className="text-slate-300 hover:text-rose-600"><X className="w-3 h-3" /></button>
                </span>
              ))}
              {rules.length === 0 && <span className="text-slate-400">Henüz öğrenilmiş kural yok.</span>}
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b text-slate-500 uppercase font-semibold">
              <tr><th className="px-4 py-2">Tarih</th><th className="px-4 py-2">Hesap</th><th className="px-4 py-2">Açıklama</th><th className="px-4 py-2 text-right">Tutar</th><th className="px-4 py-2">Cari Eşleştir</th><th className="px-4 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {unmatched.length === 0 && <tr><td colSpan={6} className="px-4 py-5 text-center text-slate-400">Eşleştirme bekleyen hareket yok.</td></tr>}
              {unmatched.map((t) => (
                <tr key={t.id} data-testid={`unmatched-tx-${t.id}`}>
                  <td className="px-4 py-2 font-mono text-slate-500">{t.date}</td>
                  <td className="px-4 py-2 font-semibold text-slate-900">{t.account_name}</td>
                  <td className="px-4 py-2">{t.description} {t.is_simulated && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-bold">SİMÜLE</span>}</td>
                  <td className={`px-4 py-2 text-right font-bold ${t.type === "inflow" ? "text-emerald-600" : "text-rose-600"}`}>{t.type === "inflow" ? "+" : "-"}{fmt(t.amount)} ₺</td>
                  <td className="px-4 py-2">
                    <select value={matchSel[t.id] || ""} onChange={(e) => setMatchSel({ ...matchSel, [t.id]: e.target.value })} className="bg-slate-50 border border-slate-200 rounded-lg p-1.5 w-44" data-testid={`match-contact-select-${t.id}`}>
                      <option value="">Cari seçilmedi (sadece onayla)</option>
                      {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{t.suggested_contact_id === c.id ? " ★ önerilen" : ""}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2"><button onClick={() => match(t)} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-700" data-testid={`match-btn-${t.id}`}>Eşleştir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto" data-testid="add-bank-connection-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Banka Bağlantısı Ekle</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={save} className="space-y-3 text-xs">
              <div><label className="block font-semibold mb-1">Sağlayıcı</label>
                <select className={inputCls} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} data-testid="conn-provider-select">{providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
                {provider?.docs && <a href={provider.docs} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-600 hover:underline">Geliştirici portalı: {provider.docs}</a>}
              </div>
              <div><label className="block font-semibold mb-1">Bağlanacak Hesap (NexusHesap)</label>
                <select className={inputCls} value={form.linked_account_id} onChange={(e) => setForm({ ...form, linked_account_id: e.target.value })} data-testid="conn-account-select">{accounts.filter((a) => a.type === "bank").map((a) => <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>)}</select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setForm({ ...form, mode: "sandbox" })} className={`p-2 rounded-lg border font-semibold ${form.mode === "sandbox" ? "bg-amber-500 text-white border-amber-500" : "bg-white"}`} data-testid="conn-mode-sandbox">Sandbox / Test</button>
                <button type="button" onClick={() => setForm({ ...form, mode: "live" })} className={`p-2 rounded-lg border font-semibold ${form.mode === "live" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`} data-testid="conn-mode-live">Canlı</button>
              </div>
              {(provider?.fields || []).map((f) => (
                <div key={f}><label className="block font-semibold mb-1">{FIELD_LABELS[f] || f} <span className="text-slate-400 font-normal">(opsiyonel — boşsa simüle)</span></label>
                  <input type={f === "client_secret" || f === "api_key" ? "password" : "text"} className={`${inputCls} font-mono`} value={form[f] || ""} onChange={(e) => setForm({ ...form, [f]: e.target.value })} data-testid={`conn-field-${f}`} /></div>
              ))}
              <div><label className="block font-semibold mb-1">Banka Hesap No / IBAN <span className="text-slate-400 font-normal">(opsiyonel)</span></label><input className={`${inputCls} font-mono`} value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} /></div>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.auto_sync} onChange={(e) => setForm({ ...form, auto_sync: e.target.checked })} /><span className="font-semibold">Otomatik senkronizasyona dahil et</span></label>
              <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="save-bank-connection-btn">Bağla & Test Et</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
