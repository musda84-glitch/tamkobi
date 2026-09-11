
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Sparkles, Trash2, Upload, Loader2 } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";

const cred = { withCredentials: true };

export const DemoContentCard = ({ companyId, variant = "settings" }) => {
  const { can } = useAuth();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState("");
  const canEdit = can("/settings", "edit");
  const load = useCallback(() => {
    if (!companyId) return;
    axios.get(`${API_URL}/demo/status`, { ...cred, params: { company_id: companyId } }).then((r) => setSt(r.data)).catch(() => setSt(null));
  }, [companyId]);
  useEffect(() => { load(); }, [load]);
  if (!canEdit || !st) return null;
  const run = async (path, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(path);
    try {
      const r = await axios.post(`${API_URL}${path}`, {}, { ...cred, params: { company_id: companyId } });
      toast.success(r.data.message);
      load();
      if (variant === "dashboard") window.location.reload();
    } catch (e) {
      toast.error(e.response?.data?.detail || "İşlem başarısız.");
    } finally { setBusy(""); }
  };
  if (variant === "dashboard") {
    if (!st.loaded) return null;
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs" data-testid="demo-banner">
        <div>
          <div className="font-bold text-amber-900">Demo içerik yüklü</div>
          <p className="text-amber-800/80 mt-0.5">Genel bakıştaki örnek cari, stok, fatura ve siparişler deneme verisidir. Kendi kayıtlarınız silinmez.</p>
        </div>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => run("/demo/clear", "Tüm demo içerik silinsin mi? Sizin eklediğiniz kayıtlar kalır.")}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-amber-300 text-amber-900 rounded-xl font-bold hover:bg-amber-100 disabled:opacity-60"
          data-testid="demo-clear-btn"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Demo içeriği sil
        </button>
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs" data-testid="demo-settings-card">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-emerald-600 mt-0.5" />
        <div>
          <h3 className="text-sm font-bold text-slate-900">Demo içerik</h3>
          <p className="text-slate-500 mt-0.5">Yeni şirketlerde örnek cari, stok, kasa/banka, fatura ve sipariş otomatik yüklenir. Buradan tekrar yükleyebilir veya silebilirsiniz.</p>
        </div>
      </div>
      <div className="text-[11px] text-slate-400">{st.loaded ? `${st.total} demo kayıt yüklü` : "Bu şirkette demo içerik yok."}</div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => run("/demo/load", st.loaded ? "Mevcut demo silinip yeniden yüklenecek. Devam edilsin mi?" : undefined)}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-xl font-bold disabled:opacity-60"
          data-testid="demo-load-btn"
        >
          {busy === "/demo/load" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Demo içeriği yükle
        </button>
        {st.loaded && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run("/demo/clear", "Tüm demo içerik silinsin mi? Sizin eklediğiniz kayıtlar kalır.")}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-xl font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            data-testid="settings-demo-clear-btn"
          >
            {busy === "/demo/clear" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Demo içeriği sil
          </button>
        )}
      </div>
    </div>
  );
};
