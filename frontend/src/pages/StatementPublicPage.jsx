import React, { useEffect, useState } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import { Loader2, Building2, AlertTriangle, FileDown } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";
import { fmtMoney } from "../utils/money";

export default function StatementPublicPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    axios.get(`${API_URL}/public/statements/${token}`)
      .then((r) => setData(r.data))
      .catch((e) => setErr(e.response?.data?.detail || "Ekstre yüklenemedi."));
  }, [token]);
  if (!data && !err) return <div className="min-h-screen flex items-center justify-center bg-slate-100"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6"><div className="bg-white rounded-2xl p-8 text-center shadow-xl max-w-sm" data-testid="public-statement-error"><AlertTriangle className="w-10 h-10 text-rose-500 mx-auto mb-2" /><div className="font-bold text-slate-900">{err}</div></div></div>;
  const c = data.company || {};
  const who = data.contact || {};
  const rows = data.rows || [];
  const bal = Number(data.balance) || 0;
  const ccy = who.currency || c.currency || data.currency || "TRY";
  const money = (n) => fmtMoney(n, ccy);
  return (
    <div className="min-h-screen bg-slate-100 py-6 px-3 sm:px-6" data-testid="public-statement-page">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {c.logo_url ? <img src={resolveImageUrl(c.logo_url)} alt="" className="h-12 bg-white rounded-lg p-1 object-contain" /> : <Building2 className="w-8 h-8 text-slate-400 shrink-0" />}
            <div className="min-w-0">
              <div className="font-bold text-lg leading-tight truncate">{c.name}</div>
              <div className="text-xs text-slate-400 truncate">{c.phone} {c.email && `• ${c.email}`}</div>
            </div>
          </div>
          <a href={`${API_URL}/public/statements/${token}/pdf`} className="shrink-0 inline-flex items-center gap-1.5 bg-white text-slate-900 text-xs font-bold px-3 py-2 rounded-xl" data-testid="public-statement-pdf">
            <FileDown className="w-4 h-4" /> PDF
          </a>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-8 space-y-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400">Sayın</div>
              <div className="font-bold text-base text-slate-900">{who.name || "Müşterimiz"}</div>
              {who.tax_number_or_id && <div className="text-xs text-slate-500">VKN/TCKN: {who.tax_number_or_id} {who.tax_office && `• ${who.tax_office}`}</div>}
              {(who.address || who.city) && <div className="text-xs text-slate-500">{who.address} {who.city}</div>}
            </div>
            <div className={`rounded-xl px-3 py-2 text-right ${bal > 0 ? "bg-rose-50" : bal < 0 ? "bg-emerald-50" : "bg-slate-50"}`} data-testid="public-statement-balance">
              <div className="text-[10px] uppercase font-bold text-slate-400">Güncel bakiye</div>
              <div className={`text-lg font-black ${bal > 0 ? "text-rose-700" : bal < 0 ? "text-emerald-700" : "text-slate-800"}`}>{money(Math.abs(bal))} <span className="text-xs font-semibold">{bal > 0 ? "Borçlu" : bal < 0 ? "Alacaklı" : ""}</span></div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" data-testid="public-statement-table">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold">
                <tr><th className="py-2 px-2">Tarih</th><th className="py-2 px-2">Belge</th><th className="py-2 px-2 text-right">Borç</th><th className="py-2 px-2 text-right">Alacak</th><th className="py-2 px-2 text-right">Bakiye</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Hareket yok.</td></tr>}
                {rows.map((r, i) => (
                  <tr key={`${r.date}-${i}`} data-testid={`public-statement-row-${i}`}>
                    <td className="py-2 px-2 font-mono text-slate-500">{r.date}</td>
                    <td className="py-2 px-2 font-semibold text-slate-800">{r.doc}</td>
                    <td className="py-2 px-2 text-right text-rose-700">{r.debit ? money(r.debit) : "—"}</td>
                    <td className="py-2 px-2 text-right text-emerald-700">{r.credit ? money(r.credit) : "—"}</td>
                    <td className="py-2 px-2 text-right font-bold">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.issued_at && <p className="text-[11px] text-slate-400">Oluşturulma: {data.issued_at}. Bu sayfa yalnızca görüntülemedir.</p>}
        </div>
      </div>
    </div>
  );
}
