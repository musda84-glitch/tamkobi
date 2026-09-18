
import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Plug, RefreshCw, Plus, X, Trash2, CheckCircle2, AlertCircle, FlaskConical, Link2, Loader2, Wand2, Settings2, Zap, Undo2, Pencil } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { BankMatchRow } from "./BankMatchRow";

const LINKABLE_ACCOUNT_TYPES = new Set(["bank", "pos", "okc_pos"]);
const PROVIDER_BANK_HINTS = {
  enpara: ["enpara"],
  kuveytturk: ["kuveyt", "kt"],
  qnb: ["qnb", "finansbank"],
  finfree: ["finfree"],
};

function linkableAccounts(accounts, { currentId, provider } = {}) {
  const hints = PROVIDER_BANK_HINTS[provider] || [];
  const rank = (a) => {
    const hay = `${a.bank_name || ""} ${a.account_name || ""}`.toLowerCase();
    const hintHit = hints.some((h) => hay.includes(h));
    if (a.type === "bank" && hintHit) return 0;
    if (a.type === "bank") return 1;
    if (hintHit) return 2;
    return 3;
  };
  return (accounts || [])
    .filter((a) => {
      const id = a.id || a._id;
      if (!LINKABLE_ACCOUNT_TYPES.has(a.type)) return false;
      if (currentId && id === currentId) return true;
      return !a.is_integrated;
    })
    .sort((a, b) => rank(a) - rank(b) || String(a.bank_name || "").localeCompare(String(b.bank_name || ""), "tr"));
}

function accountOptionLabel(a) {
  const typeLabel = a.type === "pos" ? "POS" : a.type === "okc_pos" ? "ÖKC" : "Banka";
  return `${a.bank_name || "—"} — ${a.account_name || "—"} (${typeLabel})`;
}

function linkedAccountLooksMismatched(c) {
  const hints = PROVIDER_BANK_HINTS[c?.provider] || [];
  if (!hints.length) return false;
  const hay = `${c.linked_account_bank || ""} ${c.linked_account_name || ""}`.toLowerCase();
  if (!hay.trim()) return false;
  return !hints.some((h) => hay.includes(h));
}

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";
const FIELD_LABELS = {
  client_id: "Client ID",
  client_secret: "Client Secret",
  access_token: "Access Token",
  refresh_token: "Refresh Token",
  api_key: "API Key",
  customer_number: "Müşteri Numarası",
  base_url: "API Base URL",
  token_url: "Token URL",
};

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
  const [form, setForm] = useState({ provider: "kuveytturk", linked_account_id: "", mode: "sandbox", client_id: "", client_secret: "", access_token: "", refresh_token: "", api_key: "", customer_number: "", bank_account_number: "", base_url: "", auto_sync: true });
  const [editConn, setEditConn] = useState(null);
  const [editForm, setEditForm] = useState({ provider: "enpara", linked_account_id: "", client_id: "", client_secret: "", access_token: "", refresh_token: "", customer_number: "", bank_account_number: "", mode: "live" });
  const [rules, setRules] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showRules, setShowRules] = useState(false);
  const [newRule, setNewRule] = useState({ pattern: "", contact_id: "", category: "", target_account_id: "" });
  const [invoices, setInvoices] = useState([]);
  const [matched, setMatched] = useState([]);
  const [showMatched, setShowMatched] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c, u, r, inv, m, sug] = await Promise.all([
        axios.get(`${API_URL}/banking/providers`),
        axios.get(`${API_URL}/banking/connections?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/transactions/unmatched?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/match-rules?company_id=${companyId}`),
        axios.get(`${API_URL}/invoices?company_id=${companyId}&type=all`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/banking/transactions/matched?company_id=${companyId}&limit=50`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/banking/match-rule-suggestions?company_id=${companyId}`).catch(() => ({ data: [] }))
      ]);
      setProviders(p.data); setConnections(c.data); setUnmatched(u.data); setRules(r.data); setInvoices(inv.data); setMatched(m.data); setSuggestions(sug.data);
    } catch { toast.error("Banka bağlantıları yüklenemedi."); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const provider = providers.find((p) => p.code === form.provider);

  const save = async (e) => {
    e.preventDefault();
    const linkables = linkableAccounts(accounts, { provider: form.provider });
    const linked = form.linked_account_id || linkables[0]?.id || linkables[0]?._id;
    if (!linked) {
      toast.error("Bağlanacak banka/POS hesabı seçin. Önce Hesaplar sekmesinden Enpara/Kuveyt hesabı ekleyin.");
      return;
    }
    try {
      const res = await axios.post(`${API_URL}/banking/connections`, { company_id: companyId, provider_name: "", ...form, linked_account_id: linked });
      toast[res.data.test_result?.ok ? "success" : "error"](res.data.test_result?.message);
      setShowAdd(false); load(); onSynced?.();
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

  const openEdit = (c) => {
    setEditConn(c);
    setEditForm({
      provider: c.provider || "enpara",
      linked_account_id: c.linked_account_id || "",
      client_id: c.client_id || "",
      client_secret: "",
      access_token: "",
      refresh_token: "",
      customer_number: c.customer_number || "",
      bank_account_number: c.bank_account_number || "",
      mode: c.mode || "live",
    });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editConn) return;
    try {
      const payload = { ...editForm };
      Object.keys(payload).forEach((k) => { if (payload[k] === "" || payload[k] == null) delete payload[k]; });
      await axios.put(`${API_URL}/banking/connections/${editConn.id}`, payload);
      toast.success("Bağlantı güncellendi.");
      setEditConn(null);
      const r = await axios.post(`${API_URL}/banking/connections/${editConn.id}/test`);
      toast[r.data.ok ? "success" : "error"](r.data.message);
      load();
      onSynced?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };

  const remove = async (id) => {
    try { await axios.delete(`${API_URL}/banking/connections/${id}`); toast.success("Bağlantı kaldırıldı."); load(); onSynced?.(); } catch { toast.error("Silinemedi."); }
  };

  const acceptSuggestion = async (sg) => {
    try {
      const r = await axios.post(`${API_URL}/banking/match-rule-suggestions/accept`, { company_id: companyId, pattern: sg.pattern, contact_id: sg.contact_id, target_account_id: sg.target_account_id, category: sg.category, apply_now: true });
      toast.success(r.data.message); load(); onSynced?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Kural oluşturulamadı."); }
  };

  const toggleAutoMatch = async (c) => {
    try {
      await axios.put(`${API_URL}/banking/connections/${c.id}`, { auto_match: !c.auto_match });
      toast.success(!c.auto_match ? "Otomatik işleme AKTİF: yeni hareketler öğrenilen kurallarla anında işlenecek." : "Otomatik işleme PASİF: hareketler manuel eşleştirme bekleyecek.");
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };

  const unmatch = async (tx) => {
    if (!window.confirm("Eşleşme geri alınsın mı? Cari/fatura/kasa etkileri iptal edilir.")) return;
    try { await axios.post(`${API_URL}/banking/transactions/${tx.id}/unmatch`); toast.success("Eşleşme geri alındı."); load(); onSynced?.(); }
    catch (err) { toast.error(err.response?.data?.detail || "Geri alınamadı."); }
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
      await axios.post(`${API_URL}/banking/match-rules`, { company_id: companyId, ...newRule, contact_id: newRule.contact_id || null, category: newRule.category || null, target_account_id: newRule.target_account_id || null });
      toast.success("Kural eklendi."); setNewRule({ pattern: "", contact_id: "", category: "", target_account_id: "" }); load();
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
          <button onClick={() => { const linkables = linkableAccounts(accounts, { provider: form.provider }); setForm({ ...form, linked_account_id: linkables[0]?.id || linkables[0]?._id || "" }); setShowAdd(true); }} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="add-bank-connection-btn"><Plus className="w-4 h-4" /> Banka Bağla</button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800" data-testid="bank-sim-notice">
        <b>Not:</b> API kimlik bilgisi girilmeyen bağlantılar <b>SİMÜLE</b> modda çalışır. <b>Enpara</b> QNB'den ayrıdır — Access Token yapıştırın; yoksa Client ID/Secret ile <code className="font-mono">/securedomain/oauth/token</code> kullanılır (<code className="font-mono">/oauth2/accesstoken</code> 404). IBAN 26 hane. QNB için ayrı sağlayıcı.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {connections.map((c) => (
          <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm" data-testid={`bank-conn-card-${c.id}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-slate-900 text-sm">{c.provider_name}</div>
                <div className="text-[11px] text-slate-500">→ {c.linked_account_name}</div>
                {linkedAccountLooksMismatched(c) && (
                  <div className="mt-1 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1" data-testid={`conn-link-mismatch-${c.id}`}>
                    Bağlı hesap bu sağlayıcıya ait gibi görünmüyor. <b>Düzenle</b> ile doğru banka hesabını seçin; Hesaplar sekmesinde <b>ENTEGRE</b> rozeti o hesapta (Kuveyt gibi) görünür.
                  </div>
                )}
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
            <button type="button" onClick={() => toggleAutoMatch(c)} className={`w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition ${c.auto_match ? "bg-violet-50 border-violet-300" : "bg-slate-50 border-slate-200"}`} data-testid={`auto-match-toggle-${c.id}`} aria-pressed={!!c.auto_match}>
              <span className="flex items-center gap-2 text-[11px]"><Zap className={`w-3.5 h-3.5 ${c.auto_match ? "text-violet-600" : "text-slate-400"}`} /><span><b className={c.auto_match ? "text-violet-800" : "text-slate-700"}>Otomatik İşle</b> <span className="text-slate-500">— öğrenilen cari/kasa kurallarıyla yeni hareketleri anında işle{c.auto_matched_count ? ` (${c.auto_matched_count} işlendi)` : ""}</span></span></span>
              <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${c.auto_match ? "bg-violet-600" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${c.auto_match ? "left-[18px]" : "left-0.5"}`} /></span>
            </button>
            <div className="text-[10px] text-slate-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Bu hesaba manuel gelir/gider/virman girişi kapalıdır; hareketler bankadan gelir.</div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => sync(c.id)} disabled={!!busy} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50" data-testid={`sync-conn-btn-${c.id}`}>{busy === c.id + "-sync" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Hareketleri Çek</button>
              <button type="button" onClick={() => testConn(c.id)} disabled={!!busy} className="px-3 py-1.5 border rounded-lg text-[11px] font-semibold hover:bg-slate-50" data-testid={`test-conn-btn-${c.id}`}>Bağlantıyı Test Et</button>
              <button type="button" onClick={() => openEdit(c)} className="inline-flex items-center gap-1 px-3 py-1.5 border border-emerald-200 bg-emerald-50 text-emerald-800 rounded-lg text-[11px] font-semibold hover:bg-emerald-100" data-testid={`edit-conn-btn-${c.id}`} title="Sağlayıcı, token ve hesap bilgilerini düzenle"><Pencil className="w-3.5 h-3.5" /> Düzenle</button>
              <button type="button" onClick={() => remove(c.id)} className="ml-auto p-1.5 text-slate-300 hover:text-rose-600" data-testid={`delete-conn-btn-${c.id}`}><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
        {connections.length === 0 && <div className="col-span-full text-center text-xs text-slate-400 py-8 bg-white border border-dashed rounded-2xl">Henüz banka bağlantısı yok. "Banka Bağla" ile Kuveyt Türk, Enpara, QNB veya Finfree bağlayın.</div>}
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
            <button onClick={() => setShowMatched(!showMatched)} className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-[11px] font-semibold hover:bg-slate-50 ${showMatched ? "bg-slate-900 text-white border-slate-900" : ""}`} data-testid="toggle-matched-btn"><CheckCircle2 className="w-3.5 h-3.5" /> Eşleşenler ({matched.length})</button>
          </div>
        </div>
        {showMatched && (
          <div className="border-b border-slate-100 max-h-72 overflow-auto" data-testid="matched-list">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold"><tr><th className="px-4 py-2">Tarih</th><th className="px-4 py-2">Açıklama</th><th className="px-4 py-2">Eşleşme</th><th className="px-4 py-2">Yol</th><th className="px-4 py-2 text-right">Tutar</th><th className="px-4 py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {matched.length === 0 && <tr><td colSpan={6} className="px-4 py-4 text-center text-slate-400">Henüz eşleştirilmiş hareket yok.</td></tr>}
                {matched.map((t) => (
                  <tr key={t.id} data-testid={`matched-tx-${t.id}`}>
                    <td className="px-4 py-1.5 font-mono text-slate-500">{t.date}</td>
                    <td className="px-4 py-1.5">{t.description}</td>
                    <td className="px-4 py-1.5 font-semibold text-slate-800">{t.contact_name || t.target_account_name || t.category}{t.related_invoice_number ? <span className="text-slate-400 font-normal"> · {t.related_invoice_number}</span> : ""}{t.target_account_name ? <span className="text-indigo-600 font-normal"> (virman)</span> : ""}</td>
                    <td className="px-4 py-1.5"><span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${t.matched_via === "auto" ? "bg-violet-100 text-violet-700" : t.matched_via === "rule" ? "bg-indigo-100 text-indigo-700" : t.matched_via === "suggestion" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}>{t.matched_via === "auto" ? "OTOMATİK" : t.matched_via === "rule" ? "KURAL" : t.matched_via === "suggestion" ? "ÖNERİ" : "MANUEL"}</span></td>
                    <td className={`px-4 py-1.5 text-right font-bold ${t.type === "inflow" ? "text-emerald-600" : "text-rose-600"}`}>{t.type === "inflow" ? "+" : "-"}{fmt(t.amount)} ₺</td>
                    <td className="px-4 py-1.5"><button onClick={() => unmatch(t)} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-rose-600" data-testid={`unmatch-btn-${t.id}`}><Undo2 className="w-3 h-3" /> Geri al</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="px-5 py-3 bg-amber-50/60 border-b border-amber-100 text-xs space-y-1.5" data-testid="rule-suggestions">
            <div className="font-bold text-amber-900 flex items-center gap-1.5"><Wand2 className="w-3.5 h-3.5" /> {suggestions.length} kural önerisi — aynı açıklama kalıbıyla tekrar eden eşleşmeler</div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((sg) => (
                <div key={sg.pattern} className="flex items-center gap-2 bg-white border border-amber-200 rounded-xl px-3 py-1.5" data-testid={`rule-suggestion-${sg.pattern.replace(/\s+/g, "-")}`}>
                  <div><div className="font-mono text-[11px] text-slate-800">"{sg.pattern}"</div><div className="text-[10px] text-slate-500">{sg.count}× → {[sg.contact_name, sg.target_account_name ? `${sg.target_account_name} (virman)` : null, sg.category].filter(Boolean).join(" · ")}{!sg.consistent && <span className="text-rose-600"> · farklı eşleşmeler var</span>}</div></div>
                  <button onClick={() => acceptSuggestion(sg)} className="px-2.5 py-1 bg-violet-600 text-white rounded-lg text-[11px] font-semibold hover:bg-violet-700 whitespace-nowrap" data-testid={`rule-suggestion-accept-${sg.pattern.replace(/\s+/g, "-")}`}>Kural yap</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {showRules && (
          <div className="px-5 py-3 bg-violet-50/40 border-b border-violet-100 space-y-2 text-xs" data-testid="match-rules-panel">
            <p className="text-[11px] text-slate-500">Her manuel eşleştirme otomatik kural olarak öğrenilir. İsterseniz anahtar kelime → cari/kategori kuralı da ekleyebilirsiniz.</p>
            <form onSubmit={addRule} className="flex flex-wrap gap-2 items-center">
              <input value={newRule.pattern} onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })} placeholder="Anahtar kelime (örn: trendyol)" className="bg-white border border-slate-200 rounded-lg p-1.5 w-48" required data-testid="rule-pattern-input" />
              <select value={newRule.contact_id} onChange={(e) => setNewRule({ ...newRule, contact_id: e.target.value })} className="bg-white border border-slate-200 rounded-lg p-1.5 w-44" data-testid="rule-contact-select"><option value="">Cari (opsiyonel)</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <input value={newRule.category} onChange={(e) => setNewRule({ ...newRule, category: e.target.value })} placeholder="Kategori (örn: Pazaryeri Hakediş)" className="bg-white border border-slate-200 rounded-lg p-1.5 w-48" data-testid="rule-category-input" />
              <select value={newRule.target_account_id} onChange={(e) => setNewRule({ ...newRule, target_account_id: e.target.value })} className="bg-white border border-slate-200 rounded-lg p-1.5 w-44" data-testid="rule-target-select"><option value="">Kasa/Hesap virman (ops.)</option>{accounts.filter((a) => !a.is_integrated).map((a) => <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>)}</select>
              <button type="submit" className="px-3 py-1.5 bg-violet-600 text-white rounded-lg font-semibold" data-testid="add-rule-btn">Kural Ekle</button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {rules.map((r) => (
                <span key={r.id} className="inline-flex items-center gap-1.5 bg-white border border-violet-200 rounded-md px-2 py-1 text-[11px]" data-testid={`rule-chip-${r.id}`}>
                  <b className="font-mono text-violet-800">"{r.pattern}"</b> → {[r.contact_name, r.target_account_name ? `${r.target_account_name} (virman)` : null, r.category].filter(Boolean).join(" · ") || "—"} <span className="text-slate-400">({r.hits}x)</span>
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
              <tr><th className="px-4 py-2">Tarih</th><th className="px-4 py-2">Hesap</th><th className="px-4 py-2">Açıklama</th><th className="px-4 py-2 text-right">Tutar</th><th className="px-4 py-2">Eşleştirme (Cari / Fatura / Kasa / Kategori)</th><th className="px-4 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {unmatched.length === 0 && <tr><td colSpan={6} className="px-4 py-5 text-center text-slate-400">Eşleştirme bekleyen hareket yok.</td></tr>}
              {unmatched.map((t) => <BankMatchRow key={t.id} tx={t} contacts={contacts} accounts={accounts} invoices={invoices} onDone={() => { load(); onSynced?.(); }} />)}
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
                <select className={inputCls} value={form.provider} onChange={(e) => {
                  const next = e.target.value;
                  const linkables = linkableAccounts(accounts, { provider: next });
                  setForm({ ...form, provider: next, linked_account_id: linkables[0]?.id || linkables[0]?._id || "" });
                }} data-testid="conn-provider-select">{providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
                {provider?.docs && <a href={provider.docs} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-600 hover:underline">Geliştirici portalı: {provider.docs}</a>}
                {provider?.hint && <p className="text-[10px] text-slate-500 mt-1">{provider.hint}</p>}
                {provider?.live_url && <p className="text-[10px] font-mono text-slate-400 mt-0.5">API: {provider.live_url}</p>}
              </div>
              <div><label className="block font-semibold mb-1">Bağlanacak Hesap (TamKobi)</label>
                <select className={inputCls} value={form.linked_account_id} onChange={(e) => setForm({ ...form, linked_account_id: e.target.value })} required data-testid="conn-account-select">
                  <option value="">Hesap seçin…</option>
                  {linkableAccounts(accounts, { provider: form.provider }).map((a) => <option key={a.id || a._id} value={a.id || a._id}>{accountOptionLabel(a)}</option>)}
                </select>
                <p className="text-[10px] text-amber-700 mt-1">Banka hesabı seçin (POS de mümkün). Bağlanan hesapta Hesaplar sekmesinde ENTEGRE rozeti görünür. Enpara için Enpara banka hesabı oluşturmanız önerilir.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setForm({ ...form, mode: "sandbox" })} className={`p-2 rounded-lg border font-semibold ${form.mode === "sandbox" ? "bg-amber-500 text-white border-amber-500" : "bg-white"}`} data-testid="conn-mode-sandbox">Sandbox / Test</button>
                <button type="button" onClick={() => setForm({ ...form, mode: "live" })} className={`p-2 rounded-lg border font-semibold ${form.mode === "live" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`} data-testid="conn-mode-live">Canlı</button>
              </div>
              {(provider?.fields || []).map((f) => (
                <div key={f}><label className="block font-semibold mb-1">{FIELD_LABELS[f] || f} <span className="text-slate-400 font-normal">{f === "access_token" ? "(Enpara için önerilir)" : "(opsiyonel — boşsa simüle)"}</span></label>
                  <input type={["client_secret", "api_key", "access_token", "refresh_token"].includes(f) ? "password" : "text"} className={`${inputCls} font-mono`} value={form[f] || ""} onChange={(e) => setForm({ ...form, [f]: e.target.value })} data-testid={`conn-field-${f}`} autoComplete="off" /></div>
              ))}
              <div><label className="block font-semibold mb-1">Banka Hesap No / IBAN <span className="text-slate-400 font-normal">(opsiyonel)</span></label><input className={`${inputCls} font-mono`} value={form.bank_account_number} onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })} /></div>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.auto_sync} onChange={(e) => setForm({ ...form, auto_sync: e.target.checked })} /><span className="font-semibold">Otomatik senkronizasyona dahil et</span></label>
              <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="save-bank-connection-btn">Bağla & Test Et</button></div>
            </form>
          </div>
        </div>
      )}

      {editConn && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto" data-testid="edit-bank-connection-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Pencil className="w-4 h-4 text-emerald-600" /> Bağlantıyı Düzenle</h3>
              <button type="button" onClick={() => setEditConn(null)} className="text-slate-400" data-testid="edit-conn-close"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-[11px] text-slate-500">Mevcut: <b>{editConn.provider_name}</b> → {editConn.linked_account_name}</p>
            {editForm.provider === "enpara" && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                Enpara token: portal <b>Access Token</b> yapıştırın. OAuth yolu <code className="font-mono">/securedomain/oauth/token</code> (Eski <code className="font-mono">/oauth2/accesstoken</code> 404-EPG96). IBAN 26 karakter.
              </p>
            )}
            <form onSubmit={saveEdit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Sağlayıcı</label>
                <select className={inputCls} value={editForm.provider} onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })} data-testid="edit-conn-provider">
                  {providers.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Bağlı TamKobi Hesabı</label>
                <select className={inputCls} value={editForm.linked_account_id} onChange={(e) => setEditForm({ ...editForm, linked_account_id: e.target.value })} data-testid="edit-conn-account" required>
                  {linkableAccounts(accounts, { currentId: editConn.linked_account_id, provider: editForm.provider }).map((a) => (
                    <option key={a.id || a._id} value={a.id || a._id}>{accountOptionLabel(a)}</option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">Hesaplar sekmesinde bu hesapta <b>ENTEGRE</b> rozeti görünür (Kuveyt örneği gibi). Enpara bağlantısını Enpara banka hesabına bağlayın.</p>
              </div>
              <div><label className="block font-semibold mb-1">Client ID</label><input className={`${inputCls} font-mono`} value={editForm.client_id} onChange={(e) => setEditForm({ ...editForm, client_id: e.target.value })} data-testid="edit-conn-client-id" autoComplete="off" /></div>
              <div><label className="block font-semibold mb-1">Client Secret <span className="text-slate-400 font-normal">(boş bırakırsanız değişmez)</span></label><input type="password" className={`${inputCls} font-mono`} value={editForm.client_secret} onChange={(e) => setEditForm({ ...editForm, client_secret: e.target.value })} data-testid="edit-conn-client-secret" autoComplete="off" /></div>
              <div><label className="block font-semibold mb-1">Access Token</label><textarea className={`${inputCls} font-mono min-h-[72px]`} value={editForm.access_token} onChange={(e) => setEditForm({ ...editForm, access_token: e.target.value })} data-testid="edit-conn-access-token" autoComplete="off" placeholder="Portalden Access Token yapıştırın" /></div>
              <div><label className="block font-semibold mb-1">Refresh Token</label><textarea className={`${inputCls} font-mono min-h-[56px]`} value={editForm.refresh_token} onChange={(e) => setEditForm({ ...editForm, refresh_token: e.target.value })} data-testid="edit-conn-refresh-token" autoComplete="off" /></div>
              <div><label className="block font-semibold mb-1">Müşteri No</label><input className={`${inputCls} font-mono`} value={editForm.customer_number} onChange={(e) => setEditForm({ ...editForm, customer_number: e.target.value })} data-testid="edit-conn-customer" /></div>
              <div><label className="block font-semibold mb-1">Hesap No / IBAN <span className="text-rose-600">(Enpara hareket için gerekli)</span></label>
                <input className={`${inputCls} font-mono`} value={editForm.bank_account_number} onChange={(e) => setEditForm({ ...editForm, bank_account_number: e.target.value })} data-testid="edit-conn-iban" placeholder="TR… veya hesap no" autoComplete="off" />
                <p className="text-[10px] text-slate-500 mt-1">Boşsa bağlı TamKobi hesabının IBAN’ı kullanılır. Enpara şeması IBAN’ı tam 26 karakter (boşluksuz) ister.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setEditForm({ ...editForm, mode: "sandbox" })} className={`p-2 rounded-lg border font-semibold ${editForm.mode === "sandbox" ? "bg-amber-500 text-white border-amber-500" : "bg-white"}`} data-testid="edit-conn-mode-sandbox">Sandbox</button>
                <button type="button" onClick={() => setEditForm({ ...editForm, mode: "live" })} className={`p-2 rounded-lg border font-semibold ${editForm.mode === "live" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`} data-testid="edit-conn-mode-live">Canlı</button>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button type="button" onClick={() => setEditConn(null)} className="px-3 py-1.5 border rounded-lg">İptal</button>
                <button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="save-edit-conn-btn">Kaydet & Test Et</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
