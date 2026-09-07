import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const CashApprovalsBanner = ({ companyId, onChanged, refreshKey }) => {
  const [items, setItems] = useState([]);
  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/banking/cash-approvals`, { params: { company_id: companyId, status: "pending" } });
      setItems(r.data || []);
    } catch { /* offline */ }
  }, [companyId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const act = async (id, action) => {
    try {
      const r = await axios.post(`${API_URL}/banking/cash-approvals/${id}/${action}`, {});
      toast.success(r.data.message);
      load();
      onChanged?.();
    } catch (err) { toast.error(err.response?.data?.detail || "İşlem yapılamadı."); }
  };

  if (!items.length) return null;
  return (
    <div className="space-y-2" data-testid="cash-approvals-banner">
      {items.map((r) => (
        <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs" data-testid={`cash-approval-${r.id}`}>
          <Clock className="w-4 h-4 text-amber-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-slate-900">{r.kind_label || r.kind} · onay bekliyor</div>
            <div className="text-slate-600">{r.summary} <span className="text-slate-400">· {r.requested_by_name}</span></div>
          </div>
          {r.can_approve ? (
            <div className="flex gap-1.5 shrink-0">
              <button onClick={() => act(r.id, "approve")} className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold inline-flex items-center gap-1" data-testid={`cash-approve-${r.id}`}><CheckCircle2 className="w-3.5 h-3.5" /> Onayla</button>
              <button onClick={() => act(r.id, "reject")} className="px-2.5 py-1.5 bg-rose-600 text-white rounded-lg font-semibold inline-flex items-center gap-1" data-testid={`cash-reject-${r.id}`}><XCircle className="w-3.5 h-3.5" /> Reddet</button>
            </div>
          ) : (
            <span className="text-[11px] font-semibold text-amber-800 bg-white border border-amber-200 rounded-lg px-2 py-1" data-testid={`cash-waiting-${r.id}`}>Diğer yönetici onayı bekleniyor</span>
          )}
        </div>
      ))}
    </div>
  );
};
