
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { RotateCcw, XCircle, MessageCircleQuestion, Send, PackageCheck, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { channelTr, marketplaceStatusTr } from "../utils/labels";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount((Number(n) || 0));
const dt = (s) => (s ? new Date(s).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "—");
const CLAIM_TR = { Created: "Yeni Talep", WaitingInAction: "Aksiyon Bekliyor", Accepted: "Kabul Edildi", Rejected: "Reddedildi", Cancelled: "İptal", Unresolved: "Çözümsüz", InAnalysis: "İncelemede" };

export const ClaimsPanel = ({ companyId }) => {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => axios.get(`${API_URL}/marketplace/claims?company_id=${companyId}`).then((r) => setRows(r.data)).catch(() => toast.error("İadeler yüklenemedi.")), [companyId]);
  useEffect(() => { load(); }, [load]);
  const approve = async (c, restock) => {
    if (!window.confirm(`${c.order_number} iadesi onaylansın mı?${restock ? " Ürün stoğa geri eklenecek." : ""}`)) return;
    setBusy(c.id);
    try { await axios.post(`${API_URL}/marketplace/claims/${c.id}/approve`, { restock }); toast.success("İade onaylandı" + (restock ? ", stok güncellendi." : ".")); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Onaylanamadı."); } finally { setBusy(null); }
  };
  if (!rows) return <div className="p-6 text-xs text-slate-400">Yükleniyor…</div>;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden" data-testid="claims-panel">
      <div className="px-4 py-3 border-b flex items-center justify-between"><b className="text-sm flex items-center gap-2"><RotateCcw className="w-4 h-4 text-amber-600" /> İade Talepleri ({rows.length})</b><span className="text-[11px] text-slate-500">Pazaryerinden "Senkronize Et" ile çekilir; onay Trendyol'a iletilir</span></div>
      {rows.length === 0 && <div className="p-10 text-center text-xs text-slate-400">İade talebi yok.</div>}
      <div className="divide-y divide-slate-100 text-xs">{rows.map((c) => (
        <div key={c.id} className="px-4 py-3 flex flex-wrap items-start gap-3" data-testid={`claim-${c.external_id}`}>
          <div className="flex-1 min-w-[220px]"><div className="font-bold text-slate-900">{c.order_number} <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded ml-1">{channelTr(c.channel)}</span></div><div className="text-slate-500">{c.customer_name} · {dt(c.claim_date)}{c.cargo_tracking_number ? ` · İade kargo ${c.cargo_provider || ""} ${c.cargo_tracking_number}` : ""}</div>
            <ul className="mt-1 space-y-0.5">{(c.items || []).map((it, i) => <li key={i} className="text-slate-700">• {it.product_name} <span className="text-slate-400">— {it.reason || "sebep belirtilmedi"}{it.note ? ` · "${it.note}"` : ""}</span></li>)}</ul></div>
          <div className="text-right space-y-1"><div className="font-bold">{fmt(c.total)} ₺</div><span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${c.status === "Accepted" ? "bg-emerald-100 text-emerald-700" : c.status === "Rejected" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`} data-testid={`claim-status-${c.external_id}`}>{CLAIM_TR[c.status] || c.status}</span></div>
          {["Created", "WaitingInAction", "InAnalysis"].includes(c.status) && <div className="flex flex-col gap-1"><button disabled={busy === c.id} onClick={() => approve(c, true)} className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid={`claim-approve-restock-${c.external_id}`}>{busy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />} Onayla + Stoğa Al</button><button disabled={busy === c.id} onClick={() => approve(c, false)} className="px-2.5 py-1.5 border rounded-lg font-semibold" data-testid={`claim-approve-${c.external_id}`}>Sadece Onayla</button></div>}
        </div>))}</div>
    </div>
  );
};

export const CancelledPanel = ({ orders }) => {
  const list = orders.filter((o) => ["cancelled", "returned"].includes(o.order_status));
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden" data-testid="cancelled-panel">
      <div className="px-4 py-3 border-b"><b className="text-sm flex items-center gap-2"><XCircle className="w-4 h-4 text-rose-600" /> İptal & İade Edilen Siparişler ({list.length})</b></div>
      {list.length === 0 && <div className="p-10 text-center text-xs text-slate-400">İptal edilen sipariş yok.</div>}
      <div className="divide-y divide-slate-100 text-xs">{list.map((o) => (
        <div key={o.id} className="px-4 py-2.5 flex flex-wrap items-center gap-3" data-testid={`cancelled-${o.order_number}`}>
          <span className="font-bold">{o.order_number}</span><span className="text-[10px] font-semibold bg-slate-100 px-1.5 py-0.5 rounded">{channelTr(o.channel)}</span><span className="text-slate-600">{o.customer_name}</span>
          <span className="text-slate-500">{(o.items || []).map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</span>
          <span className="ml-auto font-bold">{fmt(o.total_amount)} ₺</span><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${o.order_status === "returned" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{o.order_status === "returned" ? "İADE" : "İPTAL"}{o.marketplace_status ? ` · ${marketplaceStatusTr(o.marketplace_status)}` : ""}</span>
          {o.is_invoiced && <span className="text-[10px] text-rose-700 font-semibold">Faturalı — iade faturası gerekir</span>}
        </div>))}</div>
    </div>
  );
};

export const QuestionsPanel = ({ companyId }) => {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => axios.get(`${API_URL}/marketplace/questions?company_id=${companyId}`).then((r) => setRows(r.data)).catch(() => toast.error("Sorular yüklenemedi.")), [companyId]);
  useEffect(() => { load(); }, [load]);
  const send = async (q) => {
    setBusy(q.id);
    try { const r = await axios.post(`${API_URL}/marketplace/questions/${q.id}/answer`, { text: draft[q.id] || "" }); toast.success(r.data.message); setDraft({ ...draft, [q.id]: "" }); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(null); }
  };
  if (!rows) return <div className="p-6 text-xs text-slate-400">Yükleniyor…</div>;
  const waiting = rows.filter((q) => q.status === "WAITING_FOR_ANSWER");
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden" data-testid="questions-panel">
      <div className="px-4 py-3 border-b flex items-center justify-between"><b className="text-sm flex items-center gap-2"><MessageCircleQuestion className="w-4 h-4 text-indigo-600" /> Müşteri Soruları ({rows.length})</b>{waiting.length > 0 && <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded" data-testid="questions-waiting">{waiting.length} cevap bekliyor</span>}</div>
      {rows.length === 0 && <div className="p-10 text-center text-xs text-slate-400">Müşteri sorusu yok.</div>}
      <div className="divide-y divide-slate-100 text-xs">{rows.map((q) => (
        <div key={q.id} className="px-4 py-3 space-y-1.5" data-testid={`question-${q.external_id}`}>
          <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">{channelTr(q.channel)}</span><span className="font-semibold text-slate-800">{q.product_name}</span><span className="text-slate-400">{dt(q.asked_at)}</span><span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${q.status === "ANSWERED" ? "bg-emerald-100 text-emerald-700" : q.status === "WAITING_FOR_ANSWER" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{q.status === "ANSWERED" ? "Cevaplandı" : q.status === "WAITING_FOR_ANSWER" ? "Cevap bekliyor" : q.status}</span></div>
          <div className="bg-slate-50 rounded-xl p-2.5 text-slate-800">“{q.question}”</div>
          {q.answer ? <div className="bg-emerald-50 rounded-xl p-2.5 text-emerald-900"><b>Cevabınız:</b> {q.answer} <span className="text-emerald-600">· {dt(q.answered_at)}</span></div>
            : q.status === "WAITING_FOR_ANSWER" && <div className="flex gap-2"><textarea value={draft[q.id] || ""} onChange={(e) => setDraft({ ...draft, [q.id]: e.target.value })} rows={2} placeholder="Cevabınız (10–2000 karakter, müşteriye herkese açık gösterilir)" className="flex-1 border rounded-xl p-2 bg-white" data-testid={`answer-input-${q.external_id}`} /><button disabled={busy === q.id || (draft[q.id] || "").trim().length < 10} onClick={() => send(q)} className="self-end flex items-center gap-1 px-3 py-2 bg-indigo-600 text-white rounded-xl font-semibold disabled:opacity-50" data-testid={`answer-send-${q.external_id}`}>{busy === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Gönder</button></div>}
        </div>))}</div>
    </div>
  );
};
