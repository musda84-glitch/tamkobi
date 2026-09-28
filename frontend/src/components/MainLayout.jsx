import React, { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { useAuth, API_URL } from "../context/AuthContext";
import { useMesaimGate } from "../context/MesaimGateContext";
import { NotificationBell } from "./NotificationBell";
import { ModuleLockedPanel, LicenseBadge } from "./saas/LicenseWidgets";
import { HeaderQuickActions } from "./HeaderQuickActions";
import { RadialQuickMenu } from "./RadialQuickMenu";
import { isPublicPath } from "../utils/publicPath";
import { mesaimExclusivePathAllowed } from "../utils/attendanceSelf";
import { isPersonelRole, personelCanUseErpShortcuts, personelMenuPathAllowed } from "../utils/selfPersonnelNav";
import { erpShellReady } from "../utils/authAccess";
import TamKobiMark from "./TamKobiMark";
import { AccountMenu } from "./AccountMenu";
import { BuildStamp } from "./BuildStamp";
import AppSidebarNav from "./AppSidebarNav";
import { DataExportIconButton } from "./DataExportPanel";
import { SupportContactBar } from "./SupportContactBar";
import { useNavCounts } from "../hooks/useNavCounts";

import {
  LayoutDashboard,
  FileText,
  Users,
  Building2,
  Landmark,
  Package,
  ShoppingCart,
  Truck,
  Receipt,
  Boxes,
  Factory,
  UserCheck,
  UserRound,
  Bot,
  LogOut,
  PlusCircle,
  QrCode,
  ScanLine,
  ArrowRightLeft,
  Sparkles,
  ShieldCheck,
  Menu,
  X,
  MailOpen,
  Briefcase,
  FileSignature,
  Ruler,
  Settings,
  Calculator,
  CalendarClock,
  MonitorPlay,
  BarChart3,
  Trash2,
  Inbox,
  Globe,
  ClipboardList,
  Smartphone,
  ScrollText,
  Headset,
  PanelLeftClose,
  PanelLeft,
  Unplug,
} from "lucide-react";

const formatElapsed = (startedAt) => {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}s ${String(m).padStart(2, "0")}dk`;
  if (m > 0) return `${m}dk ${String(s).padStart(2, "0")}sn`;
  return `${s}sn`;
};

/** Sticky header: yönetim paneli bağlantısı (süre + kapat). */
const SupportConnectionChip = ({ companyId, impersonation, isAdmin, onExitImpersonation }) => {
  const [session, setSession] = useState(null);
  const [elapsed, setElapsed] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await axios.get(`${API_URL}/companies/${companyId}/support-session`, { withCredentials: true });
      setSession(r.data.session || null);
    } catch { setSession(null); }
  }, [companyId]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  const active = impersonation || session;
  const startedAt = impersonation?.started_at || session?.started_at;
  const byName = impersonation?.name || impersonation?.by || session?.name || session?.by;
  useEffect(() => {
    if (!active) { setElapsed(""); return undefined; }
    const tick = () => setElapsed(formatElapsed(startedAt));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [active, startedAt]);
  if (!active) return null;
  const close = async () => {
    setBusy(true);
    try {
      if (impersonation) {
        await onExitImpersonation();
        return;
      }
      if (!isAdmin) { toast.error("Bağlantıyı yalnızca yönetici kapatabilir."); return; }
      if (!window.confirm("Yönetim paneli bağlantısı kapatılsın mı?")) return;
      const r = await axios.post(`${API_URL}/companies/${companyId}/support-session/close`, {}, { withCredentials: true });
      toast.success(r.data.message || "Bağlantı kapatıldı.");
      setSession(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kapatılamadı.");
    } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 rounded-lg bg-slate-900 text-amber-200 px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-semibold max-w-[min(420px,55vw)]" data-testid="support-connection-chip">
      <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-amber-300" />
      <span className="truncate" data-testid="support-connection-info">
        Yönetim paneli bağlı{byName ? ` · ${byName}` : ""}
        {elapsed ? <span className="text-amber-100/80"> · {elapsed}</span> : null}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={close}
        className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-400 text-slate-900 font-bold hover:bg-amber-300 disabled:opacity-50"
        data-testid={impersonation ? "impersonation-exit" : "support-connection-close"}
        title="Bağlantıyı kapat"
      >
        <Unplug className="w-3 h-3" />
        <span className="hidden sm:inline">Bağlantıyı kapat</span>
      </button>
    </div>
  );
};

export default function MainLayout({ children, onOpenQuickAction }) {
  const { user, activeCompany, logout, feature, license, moduleOn, addonOn, loading, authenticated, menuItems: orderedMenu, moveModulePath, permPath } = useAuth();
  const { locked: mesaimLocked, ready: mesaimReady } = useMesaimGate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar_collapsed") === "1"; } catch { return false; }
  });
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("sidebar_collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const ICONS = {
    "/": LayoutDashboard, "/panel": LayoutDashboard, "/invoices": FileText, "/dis-ticaret": Globe, "/dispatches": Truck, "/expenses": Receipt,
    "/loans": Landmark, "/cheques": ScrollText, "/contacts": Users, "/banking": Landmark, "/stock": Package, "/hizli-satis": ShoppingCart,
    "/sayim": ClipboardList, "/quotes": FileSignature, "/projects": Briefcase, "/surveys": Ruler,
    "/ecommerce": ShoppingCart, "/cargo": Truck, "/orders": Boxes, "/saha": Smartphone, "/sevk": ScanLine,
    "/warehouses": Building2, "/production": Factory, "/personnel": UserCheck, "/personelim": UserRound, "/mesai": CalendarClock,
    "/communication": MailOpen, "/ai-advisor": Bot, "/settings": Settings, "/support": Headset,
    "/accountant": Calculator, "/installments": CalendarClock, "/atolye": MonitorPlay, "/reports": BarChart3,
    "/trash": Trash2, "/edoc-inbox": Inbox, "/sistem": ShieldCheck, "/b2b-yonetim": ShoppingCart,
  };
  const menuItems = (orderedMenu || [])
    .map((m) => ({ ...m, icon: ICONS[m.path] || Package }))
    .filter((m) => !mesaimLocked || m.path === "/mesai");
  const navCounts = useNavCounts(activeCompany?.id || activeCompany?._id);
  const exitImpersonation = async () => {
    try {
      const r = await axios.post(`${API_URL}/auth/impersonate/exit`, {});
      window.location.href = r.data.redirect || "/sistem/sirketler";
    } catch (e) {
      toast.error(e.response?.data?.detail || "Çıkılamadı.");
      window.location.href = "/sistem/giris";
    }
  };

  const publicSite = isPublicPath(location.pathname);
  if (publicSite) return <>{children}</>;

  // Do not paint sidebar/header until session + (when needed) Mesaim gate are ready.
  // Otherwise role-hidden / license-locked items flash on refresh and mobile back.
  if (!erpShellReady({ loading, authenticated, user, mesaimReady })) {
    if (loading || (authenticated && user?.employee_id && !mesaimReady)) {
      return (
        <div className="min-h-screen bg-slate-50 text-slate-400 flex items-center justify-center text-xs" data-testid="erp-auth-loading">
          Yükleniyor…
        </div>
      );
    }
    // Auth finished but no session — let ProtectedRoute redirect without ERP chrome.
    return <>{children}</>;
  }

  const routeKey = (permPath || ((p) => p))(location.pathname);
  const denied = user?.permissions && user.role !== "admin" && user.permissions[routeKey] === "none";
  const lockedModule = !moduleOn(location.pathname);
  const personelDenied =
    isPersonelRole(user)
    && !personelMenuPathAllowed(location.pathname, user)
    && !location.pathname.startsWith("/hesap");
  const staffUi = isPersonelRole(user);
  const erpShortcuts = personelCanUseErpShortcuts(user);
  const homePath = staffUi ? "/mesai" : "/panel";

  if (mesaimReady && mesaimLocked && !mesaimExclusivePathAllowed(location.pathname) && !isPublicPath(location.pathname)) {
    return <Navigate to="/mesai" replace />;
  }
  if (personelDenied) {
    return <Navigate to="/mesai" replace />;
  }

  const roleLabels = {
    admin: "Yönetici",
    accountant: "Muhasebe",
    sales: "Satış",
    warehouse: "Depo",
    production: "Üretim",
    personel: "Personel",
    advisor: "Mali Müşavir",
  };

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900 font-sans antialiased">
      {mobileMenuOpen ? (
        <button
          type="button"
          aria-label="Menüyü kapat"
          className="fixed inset-0 z-[35] bg-slate-900/40 lg:hidden"
          data-testid="mobile-menu-backdrop"
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}
      <aside className={`fixed inset-y-0 left-0 z-40 bg-slate-900 text-slate-200 border-r border-slate-800 flex flex-col transition-[width,transform] duration-300 lg:translate-x-0 ${sidebarCollapsed ? "w-16" : "w-64"} ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`} data-testid="app-sidebar" data-collapsed={sidebarCollapsed ? "1" : "0"}>
        <div className={`h-16 border-b border-slate-800/80 flex items-center ${sidebarCollapsed ? "px-2 justify-center gap-1" : "px-5 justify-between"}`}>
          <Link
            to={homePath}
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center font-bold text-white tracking-tight ${sidebarCollapsed ? "gap-0 justify-center" : "gap-2.5 text-lg"}`}
            data-testid="brand-logo-btn"
            title={staffUi ? "Mesaim" : "Genel Bakış"}
          >
            <TamKobiMark className="w-8 h-8 shrink-0 rounded-lg shadow-lg shadow-emerald-500/25" />
            {!sidebarCollapsed && (
              <>
                <span>Tam<span className="text-emerald-400">Kobi</span></span>
                <span className="text-[10px] uppercase tracking-widest bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-mono font-medium">ERP v2</span>
              </>
            )}
          </Link>
          <button onClick={() => setMobileMenuOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            className="hidden lg:inline-flex p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
            title={sidebarCollapsed ? "Menüyü genişlet" : "Menüyü küçült"}
            data-testid="sidebar-collapse-btn"
          >
            {sidebarCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {!sidebarCollapsed && <AccountMenu />}

        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700" data-testid="app-sidebar-nav">
          <AppSidebarNav items={menuItems} collapsed={sidebarCollapsed} counts={navCounts} onNavigate={() => setMobileMenuOpen(false)} onReorder={moveModulePath} />
        </nav>

        <div className={`border-t border-slate-800 bg-slate-950/40 space-y-2 ${sidebarCollapsed ? "p-2" : "p-3"}`}>
          <div className={`flex items-center ${sidebarCollapsed ? "flex-col gap-1.5" : "justify-between"}`}>
            <div className={`flex items-center min-w-0 ${sidebarCollapsed ? "justify-center" : "gap-2.5"}`} title={user?.name || "Kullanıcı"}>
              <div className="w-8 h-8 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center font-bold text-xs text-white shrink-0">
                {user?.name?.charAt(0) || "U"}
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{user?.name || "Kullanıcı"}</p>
                  {user?.user_number ? (
                    <p className="text-[10px] text-emerald-400 truncate font-mono" data-testid="sidebar-user-number">{user.user_number}</p>
                  ) : null}
                  <p className="text-[10px] text-slate-400 truncate">{user?.role_name || roleLabels[user?.role] || "Kullanıcı"}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <DataExportIconButton />
              <button onClick={logout} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition" title="Çıkış Yap" data-testid="logout-btn">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
          {!sidebarCollapsed && <BuildStamp tone="dark" layout="sidebar" />}
        </div>
      </aside>

      <div className={`flex-1 flex flex-col min-w-0 transition-[padding] duration-300 ${sidebarCollapsed ? "lg:pl-16" : "lg:pl-64"}`}>
        <header className="h-16 bg-white border-b border-slate-200/80 px-3 sm:px-8 flex items-center gap-2 sticky top-0 z-30 shadow-sm backdrop-blur-md bg-white/90">
          {/* Always reserve the hamburger — crowded quick actions used to push it off-screen on mobile. */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="lg:hidden shrink-0 p-2 -ml-1 text-slate-700 hover:bg-slate-100 rounded-lg"
            aria-label="Menüyü aç"
            data-testid="mobile-menu-toggle"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 min-w-0 shrink">
            <span className="font-medium text-slate-700 truncate max-w-[160px] lg:max-w-[280px]">{activeCompany?.name}</span>
            <span>•</span>
            <LicenseBadge license={license} />
          </div>
          <SupportConnectionChip
            companyId={activeCompany?.id || activeCompany?._id}
            impersonation={user?.impersonation}
            isAdmin={user?.role === "admin"}
            onExitImpersonation={exitImpersonation}
          />

          <div className="ml-auto min-w-0 flex items-center justify-end gap-1.5 sm:gap-2.5">
            {erpShortcuts && (
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                <HeaderQuickActions companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
              </div>
            )}
            {erpShortcuts && (
              <div className="hidden md:flex items-center shrink-0">
                <RadialQuickMenu companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
              </div>
            )}
            <NotificationBell companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
            {erpShortcuts && feature("header_barcode") && personelMenuPathAllowed("/stock", user) && (
              <Link to="/stock?scan=true" className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition shrink-0" data-testid="quick-barcode-scan-btn" title="Barkod Oku">
                <QrCode className="w-4 h-4 md:w-3.5 md:h-3.5 text-indigo-600" />
                <span className="hidden md:inline">Barkod Oku</span>
              </Link>
            )}
            {erpShortcuts && feature("header_virman") && personelMenuPathAllowed("/banking", user) && (
              <Link to="/banking?action=virman" className="hidden md:flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition shrink-0" data-testid="quick-virman-btn">
                <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-600" />
                <span>Virman</span>
              </Link>
            )}
            {erpShortcuts && feature("header_invoice") && personelMenuPathAllowed("/invoices", user) && (
              <Link to="/invoices?new=true" className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-sm shadow-emerald-600/30 transition shrink-0" data-testid="quick-create-invoice-btn">
                <PlusCircle className="w-3.5 h-3.5" />
                <span className="max-[380px]:hidden">Yeni Fatura</span>
              </Link>
            )}
            {erpShortcuts && feature("header_ai") && addonOn("ai.advisor") && personelMenuPathAllowed("/ai-advisor", user) && (
              <Link to="/ai-advisor" className="hidden sm:flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-sm shadow-purple-600/30 transition shrink-0" data-testid="quick-ai-btn">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Danışman</span>
              </Link>
            )}
          </div>
        </header>

        <SupportContactBar companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
        {user && user.role !== "admin" && user.features && user.features.view_prices === false && (
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-3 py-2" data-testid="prices-masked-banner">Rolünüz gereği fiyat, tutar ve bakiye bilgileri gizlenmiştir (0 olarak görünür).</div>
        )}
        <main className={`flex-1 p-4 sm:p-6 lg:p-8 w-full mx-auto ${["/orders", "/stock", "/hizli-satis", "/sevk", "/saha", "/invoices", "/dispatches", "/dis-ticaret", "/edoc-inbox"].some((p) => location.pathname.startsWith(p)) ? "max-w-[1680px]" : "max-w-7xl"}`}>
          {loading ? null : denied ? (
            <div className="bg-white border rounded-2xl p-10 text-center text-slate-600" data-testid="access-denied">
              <div className="text-lg font-bold text-slate-900 mb-1">Bu modüle erişim yetkiniz yok</div>
              <div className="text-sm">Rolünüz: {user?.role_name}. Yetki için yöneticinizle iletişime geçin.</div>
            </div>
          ) : lockedModule ? (
            <ModuleLockedPanel path={location.pathname} license={license} companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
