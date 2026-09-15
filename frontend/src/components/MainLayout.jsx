import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { useAuth, API_URL } from "../context/AuthContext";
import { NotificationBell } from "./NotificationBell";
import { ModuleLockedPanel, LicenseBadge } from "./saas/LicenseWidgets";
import { HeaderQuickActions } from "./HeaderQuickActions";
import { isPublicPath } from "../utils/publicPath";
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
} from "lucide-react";

export default function MainLayout({ children, onOpenQuickAction }) {
  const { user, activeCompany, logout, feature, license, moduleOn, addonOn, loading, menuItems: orderedMenu, moveModulePath, permPath } = useAuth();
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
  const menuItems = (orderedMenu || []).map((m) => ({ ...m, icon: ICONS[m.path] || Package }));
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
  const routeKey = (permPath || ((p) => p))(location.pathname);
  const denied = user?.permissions && user.role !== "admin" && user.permissions[routeKey] === "none";
  const lockedModule = !moduleOn(location.pathname);

  const roleLabels = {
    admin: "Yönetici",
    accountant: "Mali Müşavir",
    sales: "Satış & B2B",
    warehouse: "Depo Sorumlusu",
  };

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900 font-sans antialiased">
      <aside className={`fixed inset-y-0 left-0 z-40 bg-slate-900 text-slate-200 border-r border-slate-800 flex flex-col transition-[width,transform] duration-300 lg:translate-x-0 ${sidebarCollapsed ? "w-16" : "w-64"} ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`} data-testid="app-sidebar" data-collapsed={sidebarCollapsed ? "1" : "0"}>
        <div className={`h-16 border-b border-slate-800/80 flex items-center ${sidebarCollapsed ? "px-2 justify-center gap-1" : "px-5 justify-between"}`}>
          <Link
            to="/panel"
            onClick={() => setMobileMenuOpen(false)}
            className={`flex items-center font-bold text-white tracking-tight ${sidebarCollapsed ? "gap-0 justify-center" : "gap-2.5 text-lg"}`}
            data-testid="brand-logo-btn"
            title="Genel Bakış"
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
        <header className="h-16 bg-white border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-30 shadow-sm backdrop-blur-md bg-white/90">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg" data-testid="mobile-menu-toggle">
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{activeCompany?.name}</span>
              <span>•</span>
              <LicenseBadge license={license} />
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <HeaderQuickActions companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
            <NotificationBell companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
            {feature("header_barcode") && (
              <Link to="/stock?scan=true" className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition" data-testid="quick-barcode-scan-btn">
                <QrCode className="w-4 h-4 md:w-3.5 md:h-3.5 text-indigo-600" />
                <span className="hidden md:inline">Barkod Oku</span>
              </Link>
            )}
            {feature("header_virman") && (
              <Link to="/banking?action=virman" className="hidden md:flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition" data-testid="quick-virman-btn">
                <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-600" />
                <span>Virman</span>
              </Link>
            )}
            {feature("header_invoice") && (
              <Link to="/invoices?new=true" className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-sm shadow-emerald-600/30 transition" data-testid="quick-create-invoice-btn">
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Yeni Fatura</span>
              </Link>
            )}
            {feature("header_ai") && addonOn("ai.advisor") && (
              <Link to="/ai-advisor" className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-sm shadow-purple-600/30 transition" data-testid="quick-ai-btn">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">AI Danışman</span>
              </Link>
            )}
          </div>
        </header>

        {user?.impersonation && (
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 bg-slate-900 text-amber-200 text-xs rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2" data-testid="impersonation-banner">
            <span>
              <ShieldCheck className="inline w-3.5 h-3.5 mr-1" /> <b>Destek modu:</b> {activeCompany?.name} şirketine {user.impersonation.name || user.impersonation.by} tarafından girildi. Yaptığınız işlemler bu şirkete kaydedilir.
            </span>
            <button onClick={exitImpersonation} className="px-3 py-1 bg-amber-400 text-slate-900 rounded-lg font-bold" data-testid="impersonation-exit">Destek modunu bitir</button>
          </div>
        )}
        <SupportContactBar companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
        {user && user.role !== "admin" && user.features && user.features.view_prices === false && (
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-3 py-2" data-testid="prices-masked-banner">Rolünüz gereği fiyat, tutar ve bakiye bilgileri gizlenmiştir (0 olarak görünür).</div>
        )}
        <main className={`flex-1 p-4 sm:p-6 lg:p-8 w-full mx-auto ${["/orders", "/stock", "/hizli-satis", "/sevk", "/saha"].some((p) => location.pathname.startsWith(p)) ? "max-w-[1680px]" : "max-w-7xl"}`}>
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
