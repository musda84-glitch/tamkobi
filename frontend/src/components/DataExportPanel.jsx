import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Download, Loader2, FileArchive } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";

export const downloadPersonalDataZip = async (companyId) => {
  const r = await axios.get(`${API_URL}/me/data-export`, {
    params: companyId ? { company_id: companyId } : {},
    responseType: "blob",
    withCredentials: true,
  });
  const disp = r.headers["content-disposition"] || "";
  const m = /filename="?([^";]+)"?/i.exec(disp);
  const name = m ? m[1] : `tamkobi_veri_${new Date().toISOString().slice(0, 10)}.zip`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(r.data);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return name;
};

const fail = async (err) => {
  const d = err.response?.data;
  if (d instanceof Blob) {
    try {
      const j = JSON.parse(await d.text());
      toast.error(j.detail || "İndirilemedi.");
      return;
    } catch { /* ignore */ }
  }
  toast.error(err.response?.data?.detail || "Veri paketi indirilemedi.");
};

export const DataExportPanel = () => {
  const { activeCompany } = useAuth();
  const [busy, setBusy] = useState(false);
  const companyId = activeCompany?.id || activeCompany?._id;
  const run = async () => {
    setBusy(true);
    try {
      const name = await downloadPersonalDataZip(companyId);
      toast.success(`${name} indirildi (yalnızca metin: JSON/CSV).`);
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 text-xs max-w-xl" data-testid="data-export-panel">
      <div className="flex items-center gap-2"><FileArchive className="w-5 h-5 text-emerald-600" /><h3 className="text-sm font-bold text-slate-900">Kişisel veri dışa aktarımı</h3></div>
      <p className="text-slate-500">Hesap bilgileriniz ve bu şirketteki geçmiş faturalarınız tek bir ZIP olarak iner. Paket yalnızca metin içerir (JSON/CSV/TXT); ekran görüntüsü, PDF ve Excel dosyaları dahil edilmez.</p>
      <ul className="text-slate-600 list-disc pl-4 space-y-0.5">
        <li>Profil, şirket ve fatura kayıtları (kalemler dahil)</li>
        <li>Bağlı personel kartı, puantaj, izin ve bordro (varsa)</li>
        <li>Şifre ve API anahtarları dışarıda bırakılır</li>
      </ul>
      <button type="button" onClick={run} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold disabled:opacity-50" data-testid="data-export-btn">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} ZIP olarak indir
      </button>
    </div>
  );
};

export const DataExportIconButton = () => {
  const { activeCompany } = useAuth();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await downloadPersonalDataZip(activeCompany?.id || activeCompany?._id);
      toast.success("Veri paketi indirildi.");
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={run} disabled={busy} title="Kişisel verilerimi ZIP indir" className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded transition disabled:opacity-40" data-testid="sidebar-data-export-btn">
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
    </button>
  );
};
