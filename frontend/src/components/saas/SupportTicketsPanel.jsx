
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Inbox, Loader2, Paperclip, Send, X } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { resolveImageUrl } from "../../utils/imageUrl";
import { compressImageFile } from "../../utils/compressImage";
import { StatusFlow } from "../../pages/SupportPage";
import { fmtDate } from "./saasUi";

const cred = { withCredentials: true };
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs";
const STATUS_CLS = {
  open: "bg-sky-50 text-sky-800",
  in_progress: "bg-indigo-50 text-indigo-800",
  waiting_customer: "bg-amber-50 text-amber-800",
  resolved: "bg-emerald-50 text-emerald-800",
  closed: "bg-slate-100 text-slate-500",
};

const uploadAll = async (files, companyId, entityId) => {
  const out = [];
  for (const f of files) {
    const compressed = f.type?.startsWith("image/") ? await compressImageFile(f) : f;
    const fd = new FormData();
    fd.append("file", compressed);
    const r = await axios.post(`${API_URL}/files/upload?entity=support_ticket&entity_id=${entityId}&company_id=${companyId}`, fd, cred);
    out.push({ url: r.data.url, filename: r.data.filename, content_type: r.data.content_type, size: r.data.size });
  }
  return out;
};

export const SupportTicketsPanel = ({ onOpenCompany }) => {
  const [d, setD] = useState(null);
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    if (q.trim()) params.set("q", q.trim());
    return axios.get(`${API_URL}/system/support-tickets?${params}`, cred).then((r) => setD(r.data)).catch(() => toast.error("Destek talepleri alınamadı."));
  }, [filter, q]);
  useEffect(() => { load(); }, [load]);
  const open = async (id) => {
    try { const r = await axios.get(`${API_URL}/system/support-tickets/${id}`, cred); setSel(r.data); } catch (e) { toast.error(e.response?.data?.detail || "Açılamadı."); }
  };
  const setStatus = async (status) => {
    if (!sel) return;
    setBusy("st");
    try {
      const r = await axios.post(`${API_URL}/system/support-tickets/${sel.id}/status`, { status }, cred);
      setSel(r.data);
      load();
      toast.success(`Durum: ${r.data.status_label}`);
    } catch (e) { toast.error(e.response?.data?.detail || "Durum güncellenemedi."); } finally { setBusy(""); }
  };
  const send = async () => {
    if (!sel) return;
    setBusy("reply");
    try {
      const attachments = files.length ? await uploadAll(files, sel.company_id, sel.id) : [];
      const r = await axios.post(`${API_URL}/system/support-tickets/${sel.id}/messages`, { body: reply, attachments, is_internal: internal }, cred);
      setSel(r.data);
      setReply("");
      setFiles([]);
      setInternal(false);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Yanıt gönderilemedi."); } finally { setBusy(""); }
  };
  const list = d?.tickets || [];
  const counts = d?.counts || {};
  return (
    <div className="space-y-3 text-xs" data-testid="saas-support-tickets">
      <div className="flex flex-wrap gap-2 items-center">
        {[["", "Tümü"], ["open", "Açık"], ["in_progress", "İnceleniyor"], ["waiting_customer", "Yanıt bekleniyor"], ["resolved", "Çözüldü"], ["closed", "Kapalı"]].map(([k, l]) => (
          <button key={k || "all"} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg border font-semibold ${filter === k ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600"}`} data-testid={`st-filter-${k || "all"}`}>
            {l}{k ? ` (${counts[k] || 0})` : ""}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara…" className="ml-auto bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 w-48" data-testid="st-search" />
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl divide-y">
        {list.length === 0 && <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2"><Inbox className="w-6 h-6" /> Talep yok.</div>}
        {list.map((t) => (
          <button key={t.id} onClick={() => open(t.id)} className="w-full text-left p-3 flex flex-wrap items-center gap-3 hover:bg-slate-50" data-testid={`st-row-${t.id}`}>
            <span className="font-mono text-[10px] text-slate-400 w-28">{t.number}</span>
            <div className="flex-1 min-w-[200px]">
              <div className="font-bold text-slate-900">{t.subject}</div>
              <div className="text-[10px] text-slate-500">{t.company_name} · {t.created_by_name} · {fmtDate(t.updated_at || t.created_at)}</div>
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLS[t.status] || "bg-slate-100"}`}>{t.status_label}</span>
          </button>
        ))}
      </div>
      {sel && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex justify-end" onClick={() => setSel(null)}>
          <div className="w-full max-w-xl bg-white h-full overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()} data-testid="st-drawer">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono text-slate-400">{sel.number}</div>
                <h3 className="font-bold text-slate-900 text-sm">{sel.subject}</h3>
                <button type="button" onClick={() => onOpenCompany?.(sel.company_id)} className="text-[11px] text-indigo-700 hover:underline">{sel.company_name}</button>
              </div>
              <button onClick={() => setSel(null)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <StatusFlow statuses={d?.statuses || []} current={sel.status} />
            <div className="flex flex-wrap gap-1">{(d?.statuses || []).map((s) => (
              <button key={s.key} disabled={busy === "st"} onClick={() => setStatus(s.key)} className={`px-2 py-1 rounded-lg border text-[10px] font-semibold ${sel.status === s.key ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200"}`} data-testid={`st-set-${s.key}`}>{s.label}</button>
            ))}</div>
            <div className="space-y-2 max-h-[45vh] overflow-y-auto">
              {(sel.messages || []).map((m) => (
                <div key={m.id} className={`rounded-xl p-3 ${m.is_internal ? "bg-amber-50 border border-amber-100" : m.is_staff ? "bg-indigo-50" : "bg-slate-50"}`}>
                  <div className="text-[10px] text-slate-500 flex justify-between"><span>{m.is_internal ? "İç not" : m.is_staff ? "Destek" : m.author_name}</span><span>{m.created_at ? new Date(m.created_at).toLocaleString("tr-TR") : ""}</span></div>
                  <div className="whitespace-pre-wrap text-slate-800 mt-1">{m.body}</div>
                  <div className="flex flex-wrap gap-2 mt-2">{(m.attachments || []).map((a, i) => (a.content_type || "").startsWith("image/") ? <a key={i} href={resolveImageUrl(a.url)} target="_blank" rel="noreferrer"><img src={resolveImageUrl(a.url)} alt="" className="w-20 h-20 object-cover rounded-lg border" /></a> : <a key={i} href={resolveImageUrl(a.url)} className="text-[10px] underline" target="_blank" rel="noreferrer">{a.filename}</a>)}</div>
                </div>
              ))}
            </div>
            <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} className={inputCls} placeholder="Müşteriye yanıt…" data-testid="st-reply" />
            <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="st-internal" /> İç not (müşteri görmez)</label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 font-semibold cursor-pointer"><Paperclip className="w-3.5 h-3.5" /> Ek<input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} /></label>
              <button onClick={send} disabled={busy === "reply" || (!reply.trim() && !files.length)} className="ml-auto px-3 py-1.5 bg-amber-400 text-slate-900 rounded-lg font-bold flex items-center gap-1 disabled:opacity-40" data-testid="st-reply-btn">{busy === "reply" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Gönder</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
