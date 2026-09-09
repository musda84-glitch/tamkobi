import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Headset, Plus, Paperclip, Send, Image as ImageIcon, X, Loader2, CheckCircle2 } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";
import { useEscape } from "../utils/useEscape";

const cred = { withCredentials: true };
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-amber-400 outline-none";
const STATUS_CLS = {
  open: "bg-sky-50 text-sky-800",
  in_progress: "bg-indigo-50 text-indigo-800",
  waiting_customer: "bg-amber-50 text-amber-800",
  resolved: "bg-emerald-50 text-emerald-800",
  closed: "bg-slate-100 text-slate-500",
};

export const StatusFlow = ({ statuses = [], current }) => {
  const idx = Math.max(0, statuses.findIndex((s) => s.key === current));
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[10px]" data-testid="support-status-flow">
      {statuses.map((s, i) => {
        const done = i < idx;
        const on = s.key === current;
        return (
          <li key={s.key} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300 px-0.5">→</span>}
            <span className={`px-2 py-0.5 rounded-full font-semibold ${on ? "bg-amber-400 text-slate-900" : done ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
};

const Thumbs = ({ items }) => {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map((a, i) => {
        const href = resolveImageUrl(a.url);
        const img = (a.content_type || "").startsWith("image/");
        return img ? (
          <a key={i} href={href} target="_blank" rel="noreferrer" className="block w-24 h-24 rounded-lg overflow-hidden border border-slate-200 bg-slate-50" data-testid={`support-att-${i}`}>
            <img src={href} alt={a.filename} className="w-full h-full object-cover" />
          </a>
        ) : (
          <a key={i} href={href} target="_blank" rel="noreferrer" className="px-2 py-1.5 border rounded-lg text-[10px] font-semibold text-slate-600" data-testid={`support-att-${i}`}>{a.filename || "dosya"}</a>
        );
      })}
    </div>
  );
};

const uploadAll = async (files, companyId, entityId = "new") => {
  const out = [];
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f);
    const r = await axios.post(`${API_URL}/files/upload?entity=support_ticket&entity_id=${entityId}&company_id=${companyId}`, fd, cred);
    out.push({ url: r.data.url, filename: r.data.filename, content_type: r.data.content_type, size: r.data.size });
  }
  return out;
};

const Compose = ({ companyId, meta, onClose, onCreated }) => {
  useEscape(onClose);
  const [f, setF] = useState({ subject: "", body: "", category: "teknik", priority: "normal" });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const attachments = files.length ? await uploadAll(files, companyId) : [];
      const r = await axios.post(`${API_URL}/support/tickets`, { ...f, company_id: companyId, attachments }, cred);
      toast.success("Destek talebiniz alındı.");
      onCreated(r.data);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Talep gönderilemedi.");
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl w-full max-w-lg p-5 space-y-3 shadow-2xl max-h-[92vh] overflow-y-auto" data-testid="support-compose">
        <div className="flex items-center justify-between border-b pb-2"><h3 className="font-bold text-slate-900 flex items-center gap-2"><Headset className="w-4 h-4 text-amber-600" /> Yeni destek talebi</h3><button type="button" onClick={onClose}><X className="w-4 h-4 text-slate-400" /></button></div>
        <div><label className="block text-xs font-semibold mb-1">Konu</label><input required minLength={3} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} className={inputCls} placeholder="Kısaca ne olduğunu yazın" data-testid="support-subject" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="block text-xs font-semibold mb-1">Kategori</label><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inputCls} data-testid="support-category">{(meta.categories || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
          <div><label className="block text-xs font-semibold mb-1">Öncelik</label><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className={inputCls} data-testid="support-priority">{(meta.priorities || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
        </div>
        <div><label className="block text-xs font-semibold mb-1">Açıklama</label><textarea required minLength={8} rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className={inputCls} placeholder="Adımlar, hata mesajı, beklenen davranış…" data-testid="support-body" /></div>
        <label className="flex items-center gap-2 border-2 border-dashed border-slate-200 rounded-xl p-3 text-xs cursor-pointer hover:bg-slate-50" data-testid="support-drop">
          <ImageIcon className="w-4 h-4 text-amber-600" />
          <span>Ekran görüntüsü veya PDF ekleyin (en fazla 8)</span>
          <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])].slice(0, 8))} />
        </label>
        {!!files.length && <ul className="text-[11px] text-slate-600 space-y-0.5">{files.map((x, i) => <li key={i} className="flex justify-between"><span className="truncate">{x.name}</span><button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-rose-500">kaldır</button></li>)}</ul>}
        <button disabled={busy} className="w-full py-2.5 bg-amber-400 hover:bg-amber-500 text-slate-900 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50" data-testid="support-submit">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Talebi gönder</button>
      </form>
    </div>
  );
};

export default function SupportPage() {
  const { activeCompany, addonOn } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [meta, setMeta] = useState({ statuses: [], categories: [], priorities: [] });
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const [compose, setCompose] = useState(false);
  const [reply, setReply] = useState("");
  const [replyFiles, setReplyFiles] = useState([]);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([
        axios.get(`${API_URL}/support/meta`, cred),
        axios.get(`${API_URL}/support/tickets?company_id=${companyId}`, cred),
      ]);
      setMeta(m.data);
      setRows(t.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Talepler alınamadı."); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);
  const open = async (id) => {
    try {
      const r = await axios.get(`${API_URL}/support/tickets/${id}`, cred);
      setSel(r.data);
    } catch (e) { toast.error(e.response?.data?.detail || "Talep açılamadı."); }
  };
  const sendReply = async () => {
    if (!sel) return;
    setBusy("reply");
    try {
      const attachments = replyFiles.length ? await uploadAll(replyFiles, companyId, sel.id) : [];
      const r = await axios.post(`${API_URL}/support/tickets/${sel.id}/messages`, { body: reply, attachments }, cred);
      setSel(r.data);
      setReply("");
      setReplyFiles([]);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Mesaj gönderilemedi."); } finally { setBusy(""); }
  };
  const closeTicket = async () => {
    if (!sel || !window.confirm("Bu talebi kapatmak istiyor musunuz?")) return;
    setBusy("close");
    try {
      const r = await axios.post(`${API_URL}/support/tickets/${sel.id}/close`, {}, cred);
      setSel(r.data);
      load();
      toast.success("Talep kapatıldı.");
    } catch (e) { toast.error(e.response?.data?.detail || "Kapatılamadı."); } finally { setBusy(""); }
  };

  if (!addonOn("support.tickets")) {
    return <div className="bg-white border rounded-2xl p-10 text-center text-slate-500" data-testid="support-disabled">Destek talepleri bu şirket için kapalı.</div>;
  }

  return (
    <div className="space-y-4" data-testid="support-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Destek Talepleri</h1>
          <p className="text-xs sm:text-sm text-slate-500">Sorun bildirin, ekran görüntüsü ekleyin ve durum akışını izleyin.</p>
        </div>
        <button onClick={() => setCompose(true)} className="flex items-center gap-1.5 bg-amber-400 hover:bg-amber-500 text-slate-900 px-3.5 py-2 rounded-xl text-sm font-bold" data-testid="support-new-btn"><Plus className="w-4 h-4" /> Yeni talep</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-[520px]">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {rows.length === 0 && <div className="p-10 text-center text-xs text-slate-400 flex flex-col items-center gap-2"><Headset className="w-6 h-6" /> Henüz talep yok.</div>}
          <ul className="divide-y max-h-[70vh] overflow-y-auto">{rows.map((t) => (
            <li key={t.id}>
              <button onClick={() => open(t.id)} className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${sel?.id === t.id ? "bg-amber-50" : ""}`} data-testid={`support-row-${t.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono text-slate-400">{t.number}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLS[t.status] || "bg-slate-100"}`}>{t.status_label}</span>
                </div>
                <div className="text-sm font-semibold text-slate-900 truncate mt-0.5">{t.subject}</div>
                <div className="text-[11px] text-slate-500 truncate">{t.last_message_preview}</div>
              </button>
            </li>
          ))}</ul>
        </div>
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-4 flex flex-col min-h-[520px]" data-testid="support-thread">
          {!sel && <div className="m-auto text-xs text-slate-400">Soldan bir talep seçin veya yeni talep açın.</div>}
          {sel && (
            <>
              <div className="space-y-2 border-b pb-3 mb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono text-slate-400">{sel.number} · {sel.category_label} · {sel.priority_label}</div>
                    <h2 className="text-base font-bold text-slate-900">{sel.subject}</h2>
                  </div>
                  {sel.status !== "closed" && <button onClick={closeTicket} disabled={busy === "close"} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800" data-testid="support-close-btn">Talebi kapat</button>}
                </div>
                <StatusFlow statuses={meta.statuses} current={sel.status} />
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto max-h-[46vh] pr-1">
                {(sel.messages || []).map((m) => (
                  <div key={m.id} className={`rounded-xl p-3 text-xs ${m.is_staff ? "bg-indigo-50 border border-indigo-100" : "bg-slate-50 border border-slate-100"}`} data-testid={`support-msg-${m.id}`}>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                      <span className="font-semibold text-slate-700">{m.is_staff ? "Destek ekibi" : m.author_name}{m.is_staff && <span className="ml-1 text-indigo-600">· yanıt</span>}</span>
                      <span>{m.created_at ? new Date(m.created_at).toLocaleString("tr-TR") : ""}</span>
                    </div>
                    <div className="text-slate-800 whitespace-pre-wrap">{m.body}</div>
                    <Thumbs items={m.attachments} />
                  </div>
                ))}
              </div>
              {sel.status !== "closed" ? (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} className={inputCls} placeholder="Yanıt yazın…" data-testid="support-reply" />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 cursor-pointer"><Paperclip className="w-3.5 h-3.5" /> Ekran görüntüsü<input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setReplyFiles([...replyFiles, ...Array.from(e.target.files || [])].slice(0, 8))} data-testid="support-reply-file" /></label>
                    {replyFiles.map((f, i) => <span key={i} className="text-[10px] bg-slate-100 px-2 py-0.5 rounded">{f.name}</span>)}
                    <button onClick={sendReply} disabled={busy === "reply" || (!reply.trim() && !replyFiles.length)} className="ml-auto px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1 disabled:opacity-40" data-testid="support-reply-btn">{busy === "reply" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Gönder</button>
                  </div>
                </div>
              ) : <div className="mt-3 text-[11px] text-slate-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Bu talep kapatıldı.</div>}
            </>
          )}
        </div>
      </div>
      {compose && <Compose companyId={companyId} meta={meta} onClose={() => setCompose(false)} onCreated={(t) => { setRows((r) => [t, ...r]); setSel(t); }} />}
    </div>
  );
}
