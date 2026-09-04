import React, { useEffect, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2, FileSignature, Building2, CalendarClock, AlertTriangle } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

export default function QuoteApprovalPage() {
  const { token } = useParams();
  const [q, setQ] = useState(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/public/quotes/${token}`).then((r) => setQ(r.data)).catch((e) => setErr(e.response?.data?.detail || "Teklif yüklenemedi.")); }, [token]);
  const respond = async (decision) => {
    if (!name.trim()) { setErr("Lütfen ad soyad girin."); return; }
    if (decision === "rejected" && !window.confirm("Teklifi reddetmek istediğinize emin misiniz?")) return;
    setBusy(true); setErr("");
    try { const r = await axios.post(`${API_URL}/public/quotes/${token}/respond`, { decision, name, note }); setResult(r.data); setQ(r.data.quote); }
    catch (e) { setErr(e.response?.data?.detail || "İşlem başarısız."); } finally { setBusy(false); }
  };
  if (!q && !err) return <div className="min-h-screen flex items-center justify-center bg-slate-100"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!q) return <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6"><div className="bg-white rounded-2xl p-8 text-center shadow-xl max-w-sm" data-testid="public-quote-error"><AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-2" /><div className="font-bold text-slate-900">{err}</div></div></div>;
  const decided = q.approval?.status === "accepted" || q.approval?.status === "rejected";
  const c = q.company || {};
  return (
    <div className="min-h-screen bg-slate-100 py-6 px-3 sm:px-6" data-testid="public-quote-page">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">{c.logo_url ? <img src={resolveImageUrl(c.logo_url)} alt="" className="h-12 bg-white rounded-lg p-1 object-contain" /> : <Building2 className="w-8 h-8 text-slate-400" />}<div><div className="font-bold text-lg leading-tight">{c.name}</div><div className="text-xs text-slate-400">{c.phone} {c.email && `• ${c.email}`}</div></div></div>
          <div className="text-right"><div className="text-[10px] uppercase tracking-wide text-slate-400">Fiyat Teklifi</div><div className="font-mono font-bold">{q.quote_number}</div></div>
        </div>
        {result && <div className={`rounded-2xl p-4 flex items-center gap-3 font-semibold ${q.approval.status === "accepted" ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-rose-50 border border-rose-200 text-rose-800"}`} data-testid="public-quote-result">{q.approval.status === "accepted" ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />} {result.message}</div>}
        <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-8 space-y-5 text-sm">
          <div className="flex flex-wrap justify-between gap-3">
            <div><div className="text-[10px] uppercase font-bold text-slate-400">Sayın</div><div className="font-bold text-base text-slate-900">{q.contact_name}</div><div className="text-slate-600">{q.title}</div></div>
            <div className="text-right text-xs text-slate-500"><div>Tarih: <b>{q.issue_date}</b></div>{q.valid_until && <div className={q.is_expired ? "text-rose-600 font-semibold" : ""}>Geçerlilik: <b>{q.valid_until}</b>{q.is_expired && " (süresi doldu)"}</div>}</div>
          </div>
          <table className="w-full text-xs sm:text-sm">
            <thead><tr className="bg-slate-900 text-white"><th className="text-left p-2 rounded-l-lg">Açıklama</th><th className="text-right p-2">Miktar</th><th className="text-right p-2">Birim Fiyat</th><th className="text-right p-2 rounded-r-lg">Tutar</th></tr></thead>
            <tbody>{(q.items || []).map((it, i) => <tr key={i} className="border-b border-slate-100"><td className="p-2">{it.name}</td><td className="p-2 text-right">{it.quantity} {it.unit || ""}</td><td className="p-2 text-right">{fmt(it.unit_price)} ₺</td><td className="p-2 text-right font-semibold">{fmt(it.total ?? it.quantity * it.unit_price)} ₺</td></tr>)}</tbody>
          </table>
          <div className="flex justify-end"><div className="w-64 space-y-1 text-sm"><div className="flex justify-between text-slate-500"><span>Ara Toplam</span><span>{fmt(q.subtotal)} ₺</span></div><div className="flex justify-between text-slate-500"><span>KDV</span><span>{fmt(q.vat_total)} ₺</span></div><div className="flex justify-between text-lg font-black border-t-2 border-slate-900 pt-1"><span>TOPLAM</span><span>{fmt(q.grand_total)} ₺</span></div></div></div>
          {q.payment_plan?.rows?.length > 0 && <div className="bg-violet-50 border border-violet-100 rounded-xl p-3"><div className="flex items-center gap-1 font-bold text-violet-800 text-xs mb-1"><CalendarClock className="w-3.5 h-3.5" /> Ödeme Planı ({q.payment_plan.rows.length} taksit)</div><div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-xs">{q.payment_plan.rows.map((r) => <div key={r.no} className="flex justify-between border-b border-violet-100 py-1"><span>{r.label}</span><span className="text-slate-500">{r.due_date}</span><b>{fmt(r.amount)} ₺</b></div>)}</div></div>}
          {(q.notes || q.terms) && <div className="text-xs text-slate-600 whitespace-pre-wrap">{q.notes}{q.terms && <div className="mt-1"><b>Şartlar:</b> {q.terms}</div>}</div>}
          {q.images?.length > 0 && <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">{q.images.map((img) => <img key={img} src={resolveImageUrl(img)} alt="" className="w-full h-24 object-cover rounded-lg border" />)}</div>}
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-8 space-y-3" data-testid="public-quote-decision">
          <h3 className="font-bold text-slate-900 flex items-center gap-1.5"><FileSignature className="w-4 h-4 text-emerald-600" /> Kararınız</h3>
          {decided ? (
            <div className={`rounded-xl p-4 text-sm ${q.approval.status === "accepted" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`} data-testid="public-quote-decided">Bu teklif <b>{q.approval.responder_name}</b> tarafından {new Date(q.approval.responded_at).toLocaleString("tr-TR")} tarihinde <b>{q.approval.status === "accepted" ? "ONAYLANDI" : "REDDEDİLDİ"}</b>.{q.approval.note && <div className="mt-1 text-xs">Not: {q.approval.note}</div>}</div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold text-slate-700 mb-1">Ad Soyad *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Onaylayan kişi" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm" data-testid="public-quote-name" /></div>
                <div><label className="block text-xs font-semibold text-slate-700 mb-1">Not (isteğe bağlı)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Teslim tarihi, revizyon isteği…" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm" data-testid="public-quote-note" /></div>
              </div>
              {err && <div className="text-xs text-rose-600 font-semibold" data-testid="public-quote-err">{err}</div>}
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button onClick={() => respond("accepted")} disabled={busy} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold disabled:opacity-50" data-testid="public-quote-accept">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Teklifi Onaylıyorum</button>
                <button onClick={() => respond("rejected")} disabled={busy} className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xl font-bold disabled:opacity-50" data-testid="public-quote-reject"><XCircle className="w-5 h-5" /> Reddet</button>
              </div>
              <p className="text-[11px] text-slate-400">Onayınız elektronik olarak kaydedilir (tarih, saat, IP). Sorularınız için {c.phone || c.email}.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
