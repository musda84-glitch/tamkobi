
import React, { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ShieldCheck, LayoutGrid, Building2, Package, Boxes, Inbox, CreditCard, Settings, LogOut, ExternalLink, Bell, Users, Globe, Sparkles, Mail, Gauge, Bot, Headset } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { SYSTEM_NAV_GROUPS } from "../../navGroups";

export const SYSTEM_NAV = [
  ["/sistem", "Genel Bakış", LayoutGrid],
  ["/sistem/web", "Web Sitesi", Globe],
  ["/sistem/posta", "Posta Sunucusu", Mail],
  ["/sistem/ai", "AI Entegrasyonu", Sparkles],
  ["/sistem/sirketler", "Şirketler & Lisanslar", Building2],
  ["/sistem/kotalar", "Kotalar", Gauge],
  ["/sistem/kullanicilar", "Panel Yöneticileri", Users],
  ["/sistem/paketler", "Paketler", Package],
  ["/sistem/moduller", "Modül Kataloğu", Boxes],
  ["/sistem/araclar", "AI & Destek", Bot],
  ["/sistem/destek", "Destek Talepleri", Headset],
  ["/sistem/talepler", "Yükseltme Talepleri", Inbox],
  ["/sistem/odemeler", "Ödemeler", CreditCard],
  ["/sistem/hatirlatmalar", "Hatırlatmalar", Bell],
  ["/sistem/ayarlar", "Platform Ayarları", Settings],
];

const ICONS = Object.fromEntries(SYSTEM_NAV.map(([path, , Icon]) => [path, Icon]));
const LABELS = Object.fromEntries(SYSTEM_NAV.map(([path, label]) => [path, label]));

export const SystemLayout = ({ children, pendingCount = 0, openTickets = 0 }) => {
  const { user, loading, logout, authenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && (!user || !user.is_super_admin || !authenticated)) navigate("/sistem/giris", { replace: true });
  }, [loading, user, authenticated, navigate]);
  if (loading || !user?.is_super_admin || !authenticated) {
    return <div className="min-h-screen bg-[#0b0f1a] text-slate-400 flex items-center justify-center text-xs" data-testid="system-loading">Yükleniyor…</div>;
  }
  const here = location.pathname.replace(/\/+$/, "") || "/sistem";
  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-100 flex" data-testid="system-layout">
      <aside className="w-64 shrink-0 border-r border-white/5 bg-[#0e1422] flex flex-col">
        <div className="h-16 px-5 flex items-center gap-2.5 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center text-slate-900"><ShieldCheck className="w-4 h-4" /></div>
          <div>
            <div className="font-bold text-sm leading-tight" data-testid="sys-brand">Tam<span className="text-amber-400">Kobi</span></div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Platform Yönetimi</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto" data-testid="sys-sidebar-nav">
          {SYSTEM_NAV_GROUPS.map((g) => {
            const paths = g.paths.filter((p) => LABELS[p]);
            if (!paths.length) return null;
            const groupActive = paths.some((p) => here === p);
            const links = paths.map((path) => {
              const Icon = ICONS[path];
              const active = here === path;
              return (
                <Link key={path} to={path} className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${active ? "bg-amber-400 text-slate-900" : "text-slate-400 hover:bg-white/5 hover:text-white"}`} data-testid={`sys-nav-${path.replace("/sistem", "").replace("/", "") || "overview"}`}>
                  <span className="flex items-center gap-2.5">{Icon && <Icon className="w-4 h-4" />}{LABELS[path]}</span>
                  {path === "/sistem/talepler" && pendingCount > 0 && <span className="bg-rose-500 text-white rounded-full px-1.5 text-[10px] font-bold">{pendingCount}</span>}
                  {path === "/sistem/destek" && openTickets > 0 && <span className="bg-rose-500 text-white rounded-full px-1.5 text-[10px] font-bold">{openTickets}</span>}
                </Link>
              );
            });
            if (!g.label) return <div key={g.id} className="space-y-0.5">{links}</div>;
            return (
              <div key={g.id} className={`rounded-lg border overflow-hidden ${groupActive ? "border-amber-500/30 bg-white/5" : "border-white/5 bg-white/[0.02]"}`} data-testid={`sys-nav-group-${g.id}`}>
                <div className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider ${groupActive ? "text-amber-300" : "text-slate-500"}`}>{g.label}</div>
                <div className="px-1 pb-1 space-y-0.5">{links}</div>
              </div>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/5 space-y-2">
          <a href="/web" target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] text-slate-400 hover:bg-white/5 hover:text-white" data-testid="sys-go-site"><Globe className="w-3.5 h-3.5" /> Müşteri sitesini aç</a>
          <Link to="/" className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] text-slate-400 hover:bg-white/5 hover:text-white" data-testid="sys-go-erp"><ExternalLink className="w-3.5 h-3.5" /> ERP uygulamasına git</Link>
          <div className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-xl">
            <div className="min-w-0"><div className="text-xs font-semibold truncate">{user.name}</div><div className="text-[10px] text-amber-400">Süper Admin</div></div>
            <button onClick={() => logout("/sistem/giris")} className="p-1.5 text-slate-400 hover:text-rose-400" title="Çıkış" data-testid="sys-logout"><LogOut className="w-4 h-4" /></button>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-6 lg:p-8 overflow-y-auto">{children}</main>
    </div>
  );
};
