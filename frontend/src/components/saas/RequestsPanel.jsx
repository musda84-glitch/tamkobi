import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Inbox } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { fmtDate } from "./saasUi";

export const RequestsPanel = ({ requests, onChanged, onOpenCompany }) => {
  const [filter, setFilter] = useState("pending");
  const list = requests.filter((r) => !filter || r.status === filter);
  const resolve = async (r, status) => {
    const note = status === "rejected" ? window.prompt("Ret notu (müşteriye iletilir):") ?? "" : "";
    try { await axios.put(`${API_URL}/system/upgrade-requests/${r.id}`, { status, note, apply: true }); toast.success(status === "approved" ? `${r.company_name} → ${r.plan_name} aktif edildi.` : "Talep reddedildi."); onChanged(); } catch (e) { toast.error(e.response?.data?.detail || "İşlem başarısız."); }
  };
  return (
    <div className="space-y-3 text-xs" data-testid="saas-requests">
      <div className="flex gap-2">{[["pending", "Bekleyen"], ["approved", "Onaylanan"], ["rejected", "Reddedilen"], ["", "Tümü"]].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg border font-semibold ${filter === k ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600"}`} data-testid={`req-filter-${k || "all"}`}>{l} ({requests.filter((r) => !k || r.status === k).length})</button>)}</div>
      <div className="bg-white border border-slate-200 rounded-2xl divide-y">
        {list.length === 0 && <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-2"><Inbox className="w-6 h-6" /> Talep yok.</div>}
        {list.map((r) => (
          <div key={r.id} className="p-3 flex flex-wrap items-center gap-3" data-testid={`req-row-${r.id}`}>
            <div className="flex-1 min-w-[240px]"><button onClick={() => onOpenCompany(r.company_id)} className="font-bold text-slate-900 hover:underline">{r.company_name || r.company_id}</button> <span className="text-slate-500">→</span> <b className="text-indigo-700">{r.plan_name}</b>
              <div className="text-[10px] text-slate-500">{r.message} · {r.requested_by || "?"} · {fmtDate(r.created_at)}{r.admin_note ? ` · Not: ${r.admin_note}` : ""}</div></div>
            {r.status === "pending" ? (<div className="flex gap-2"><button onClick={() => resolve(r, "approved")} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold flex items-center gap-1" data-testid={`req-approve-${r.id}`}><CheckCircle2 className="w-3.5 h-3.5" /> Onayla & Aktif Et</button><button onClick={() => resolve(r, "rejected")} className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded-lg font-semibold flex items-center gap-1" data-testid={`req-reject-${r.id}`}><XCircle className="w-3.5 h-3.5" /> Reddet</button></div>)
              : <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${r.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{r.status === "approved" ? "Onaylandı" : "Reddedildi"} · {fmtDate(r.resolved_at)}</span>}
          </div>))}
      </div>
    </div>
  );
};
