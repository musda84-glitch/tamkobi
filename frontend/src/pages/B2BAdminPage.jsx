
import React from "react";
import { toast } from "sonner";
import { ShoppingCart, Copy, ExternalLink, FileSpreadsheet, KeyRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { B2BSettings } from "./SettingsPage";
import { LegalTextsPanel } from "../components/LegalTextsPanel";

export default function B2BAdminPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const url = `${window.location.origin}/b2b/giris`;
  return (
    <div className="space-y-5" data-testid="b2b-admin-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><ShoppingCart className="w-6 h-6 text-emerald-600" /> B2B Portal Yönetimi</h1><p className="text-sm text-slate-500">Bayi/müşteri portalı ayarları, müşteri erişimleri, giriş şifreleri ve iskontolar.</p></div>
        <div className="bg-slate-900 text-white rounded-2xl px-4 py-3 text-xs flex flex-wrap items-center gap-3" data-testid="b2b-login-url-card"><div><div className="text-[10px] uppercase tracking-wider text-slate-400">Müşteri giriş adresi</div><div className="font-mono font-bold text-emerald-300">{url}</div></div><button onClick={() => { navigator.clipboard?.writeText(url); toast.success("Adres kopyalandı."); }} className="px-3 py-1.5 bg-white/10 rounded-lg font-semibold flex items-center gap-1 hover:bg-white/20" data-testid="b2b-copy-url"><Copy className="w-3.5 h-3.5" /> Kopyala</button><a href={url} target="_blank" rel="noreferrer" className="px-3 py-1.5 bg-emerald-500 text-slate-900 rounded-lg font-bold flex items-center gap-1" data-testid="b2b-open-url"><ExternalLink className="w-3.5 h-3.5" /> Aç</a></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        {[[KeyRound, "1. Erişim ver", "Aşağıdaki listede müşteriyi Aç yapın, 'Şifre Tanımla' ile giriş e-postası + şifre verin (cari kartındaki B2B Portal sekmesinden de yapılabilir)."], [ExternalLink, "2. Müşteri girer", "Müşteri giriş adresinden e-posta/VKN + şifre ile girer; size özel iskontolu fiyatları, stokları ve ekstresini görür."], [FileSpreadsheet, "3. AI ile sipariş", "Excel/PDF sipariş listesini yükler, AI ürünlerle eşler, sepet otomatik oluşur; sipariş Siparişler ekranına B2B kanalıyla düşer."]].map(([I, t, d]) => <div key={t} className="bg-white border border-slate-200 rounded-2xl p-4 flex gap-3"><span className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><I className="w-4 h-4" /></span><div><div className="font-bold text-slate-900">{t}</div><div className="text-slate-500 mt-0.5">{d}</div></div></div>)}
      </div>
      <B2BSettings companyId={companyId} />
      <LegalTextsPanel companyId={companyId} />
    </div>
  );
}
