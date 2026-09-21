
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { Loader2, Building2, AlertTriangle, CheckCircle2, Circle, MapPin, CalendarClock, FileSignature, Ruler, ClipboardList, Camera } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";

const SURVEY_TR = { planned: "Planlandı", done: "Yapıldı", quoted: "Teklife dönüştü" };
const QUOTE_TR = { draft: "Hazırlanıyor", sent: "Gönderildi", accepted: "Onaylandı", rejected: "Reddedildi" };
const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

export default function ProjectTrackingPage() {
  const { token } = useParams();
  const [p, setP] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    axios.get(`${API_URL}/public/projects/${token}`)
      .then((r) => setP(r.data))
      .catch((e) => setErr(e.response?.data?.detail || "Proje yüklenemedi."));
  }, [token]);
  if (!p && !err) return <div className="min-h-screen flex items-center justify-center bg-slate-100"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!p) return <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6"><div className="bg-white rounded-2xl p-8 text-center shadow-xl max-w-sm" data-testid="public-project-error"><AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-2" /><div className="font-bold text-slate-900">{err}</div></div></div>;
  const c = p.company || {};
  return (
    <div className="min-h-screen bg-slate-100 py-6 px-3 sm:px-6" data-testid="public-project-page">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {c.logo_url ? <img src={resolveImageUrl(c.logo_url)} alt="" className="h-12 bg-white rounded-lg p-1 object-contain" /> : <Building2 className="w-8 h-8 text-slate-400" />}
            <div>
              <div className="font-bold text-lg leading-tight">{c.name}</div>
              <div className="text-xs text-slate-400">{c.phone} {c.email && `• ${c.email}`}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Proje Takibi</div>
            <div className="font-mono font-bold">{p.project_number}</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-8 space-y-5">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Sayın</div>
              <div className="font-bold text-base text-slate-900">{p.contact_name || "Müşterimiz"}</div>
              <div className="text-slate-800 font-semibold">{p.name}</div>
            </div>
            <div className="text-right">
              <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-bold ${p.status === "completed" ? "bg-emerald-50 text-emerald-700" : p.status === "on_hold" ? "bg-amber-50 text-amber-700" : p.status === "active" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`} data-testid="public-project-status">{p.status_label}</span>
              {(p.start_date || p.end_date) && <div className="text-xs text-slate-500 mt-1 flex items-center justify-end gap-1"><CalendarClock className="w-3.5 h-3.5" />{[p.start_date, p.end_date].filter(Boolean).join(" → ")}</div>}
            </div>
          </div>
          {(p.address || p.location_url) && (
            <div className="text-xs text-slate-600 flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-rose-500 mt-0.5 shrink-0" />
              <span>{p.address}{p.location_url && <> {p.address && " "}<a href={p.location_url} target="_blank" rel="noreferrer" className="text-emerald-700 font-semibold underline">Haritada aç</a></>}</span>
            </div>
          )}
          {p.description && <p className="text-sm text-slate-600 whitespace-pre-wrap">{p.description}</p>}

          <ol className="space-y-0" data-testid="public-project-steps">
            {(p.steps || []).map((s, i) => (
              <li key={s.key} className="flex gap-3" data-testid={`public-project-step-${s.key}`}>
                <div className="flex flex-col items-center">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${s.done ? "bg-emerald-600 text-white" : s.current ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>
                    {s.done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-3.5 h-3.5" />}
                  </div>
                  {i < p.steps.length - 1 && <div className={`w-0.5 flex-1 min-h-[18px] ${s.done ? "bg-emerald-300" : "bg-slate-200"}`} />}
                </div>
                <div className={`pb-4 ${s.current ? "font-bold text-slate-900" : s.done ? "text-slate-700" : "text-slate-400"}`}>
                  <div className="text-sm pt-1">{s.label}</div>
                  {s.current && !s.done && <div className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">Şu anki adım</div>}
                </div>
              </li>
            ))}
          </ol>

          {p.tasks?.length > 0 && (
            <div className="border-t pt-4 space-y-1.5" data-testid="public-project-tasks">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800"><ClipboardList className="w-3.5 h-3.5" /> İş adımları</div>
              {p.tasks.map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {t.done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
                  <span className={`min-w-0 flex-1 ${t.done ? "text-slate-500 line-through" : "text-slate-800"}`}>{t.title}</span>
                  {t.assignee_name && <span className="text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded shrink-0">{t.assignee_name}</span>}
                </div>
              ))}
            </div>
          )}

          {p.surveys?.length > 0 && (
            <div className="border-t pt-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800"><Ruler className="w-3.5 h-3.5" /> Keşifler</div>
              {p.surveys.map((s) => (
                <div key={s.survey_number} className="flex justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-mono font-semibold">{s.survey_number}</span>
                  <span className="text-slate-500">{s.survey_date}</span>
                  <span className="font-semibold">{SURVEY_TR[s.status] || s.status}</span>
                </div>
              ))}
            </div>
          )}

          {p.quotes?.length > 0 && (
            <div className="border-t pt-4 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800"><FileSignature className="w-3.5 h-3.5" /> Teklifler</div>
              {p.quotes.map((q) => (
                <div key={q.quote_number} className="flex justify-between text-xs bg-slate-50 rounded-lg px-3 py-2 gap-2">
                  <span className="font-mono font-semibold">{q.quote_number}</span>
                  <span className="text-slate-600 truncate">{q.title}</span>
                  <span className="font-semibold shrink-0">{QUOTE_TR[q.approval_status] || QUOTE_TR[q.status] || q.status}</span>
                </div>
              ))}
            </div>
          )}

          {p.statement && (
            <div className="border-t pt-4 space-y-2" data-testid="public-project-statement">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-800">Hesap ekstresi</div>
                <div className={`text-xs font-black ${Number(p.statement.balance) > 0 ? "text-rose-700" : Number(p.statement.balance) < 0 ? "text-emerald-700" : "text-slate-700"}`} data-testid="public-project-statement-balance">
                  {fmt(Math.abs(p.statement.balance))} ₺ {Number(p.statement.balance) > 0 ? "borç" : Number(p.statement.balance) < 0 ? "alacak" : ""}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase text-slate-400"><tr><th className="py-1 pr-2">Tarih</th><th className="py-1 pr-2">Belge</th><th className="py-1 text-right">Borç</th><th className="py-1 text-right">Alacak</th><th className="py-1 text-right">Bakiye</th></tr></thead>
                  <tbody>
                    {(p.statement.rows || []).length === 0 && <tr><td colSpan={5} className="py-3 text-slate-400">Hareket yok.</td></tr>}
                    {(p.statement.rows || []).map((r, i) => (
                      <tr key={`${r.date}-${i}`} className="border-t border-slate-100" data-testid={`public-project-statement-row-${i}`}>
                        <td className="py-1.5 pr-2 font-mono text-slate-500">{r.date}</td>
                        <td className="py-1.5 pr-2">{r.doc}</td>
                        <td className="py-1.5 text-right">{r.debit ? fmt(r.debit) : ""}</td>
                        <td className="py-1.5 text-right">{r.credit ? fmt(r.credit) : ""}</td>
                        <td className="py-1.5 text-right font-semibold">{fmt(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(() => {
            const groups = (p.stage_photos || []).length
              ? p.stage_photos
              : (p.images || []).length
                ? [{ stage: "other", label: "Yapılan işler", images: p.images }]
                : [];
            if (!groups.length) return null;
            return (
              <div className="border-t pt-4 space-y-3" data-testid="public-project-photos">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800"><Camera className="w-3.5 h-3.5" /> Yapılan işler</div>
                {groups.map((g) => (
                  <div key={g.stage} data-testid={`public-project-photos-${g.stage}`}>
                    {(groups.length > 1 || g.stage !== "other") && <div className="text-[11px] font-semibold text-slate-500 mb-1.5">{g.label}</div>}
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {(g.images || []).map((img) => <img key={img} src={resolveImageUrl(img)} alt="" className="w-full h-24 object-cover rounded-lg border" />)}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
        <p className="text-center text-[11px] text-slate-400">Bu sayfa yalnızca görüntülemedir; giriş yapmanız gerekmez. Sorularınız için {c.phone || c.email || "firmanız"}.</p>
      </div>
    </div>
  );
}
