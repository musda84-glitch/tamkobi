import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { useAuth, API_URL } from "../context/AuthContext";
import { NotificationBell } from "./NotificationBell";
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
  Bot,
  LogOut,
  PlusCircle,
  QrCode,
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
  ScrollText,
  Inbox,
} from "lucide-react";
import { ModuleLockedPanel, LicenseBadge } from "./saas/LicenseWidgets";
import { HeaderQuickActions } from "./HeaderQuickActions";
import { AccountMenu } from "./AccountMenu";

export default function MainLayout({ children, onOpenQuickAction }) {
  const { user, activeCompany, logout, feature, license, moduleOn, loading, authenticated } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const ICONS = { "/": LayoutDashboard, "/invoices": FileText, "/dispatches": Truck, "/expenses": Receipt, "/loans": Landmark, "/cheques": ScrollText, "/contacts": Users, "/banking": Landmark, "/stock": Package, "/quotes": FileSignature, "/projects": Briefcase, "/surveys": Ruler, "/ecommerce": ShoppingCart, "/cargo": Truck, "/orders": Boxes, "/warehouses": Building2, "/production": Factory, "/personnel": UserCheck, "/mesai": CalendarClock, "/communication": MailOpen, "/ai-advisor": Bot, "/settings": Settings, "/accountant": Calculator, "/installments": CalendarClock, "/atolye": MonitorPlay, "/reports": BarChart3, "/trash": Trash2, "/edoc-inbox": Inbox, "/sistem": ShieldCheck, "/b2b-yonetim": ShoppingCart };
  const { menuItems: orderedMenu, moveModule } = useAuth();
  const menuItems = orderedMenu.map((m) => ({ ...m, icon: ICONS[m.path] || Package }));
  const [dragIdx, setDragIdx] = useState(null);
  const exitImpersonation = async () => { try { const r = await axios.post(`${API_URL}/auth/impersonate/exit`, {}); window.location.href = r.data.redirect || "/sistem/sirketler"; } catch (e) { toast.error(e.response?.data?.detail || "Çıkılamadı."); window.location.href = "/sistem/giris"; } };

  const publicSite = location.pathname === "/" && !authenticated;
  if (publicSite || ["/teklif/", "/portal/", "/davet/", "/login", "/sistem", "/web", "/fiyatlar", "/kayit", "/odeme/", "/yenile/", "/b2b/"].some((p) => location.pathname.startsWith(p))) return <>{children}</>;
  const denied = user?.permissions && user.role !== "admin" && user.permissions[location.pathname] === "none";
  const lockedModule = !moduleOn(location.pathname);

  const roleLabels = {
    admin: "Yönetici",
    accountant: "Mali Müşavir",
    sales: "Satış & B2B",
    warehouse: "Depo Sorumlusu"
  };

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900 font-sans antialiased">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-slate-200 border-r border-slate-800 flex flex-col transition-transform duration-300 lg:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Brand Header */}
        <div className="h-16 px-5 border-b border-slate-800/80 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 font-bold text-lg text-white tracking-tight" data-testid="brand-logo-btn">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-500 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <span>Nexus<span className="text-emerald-400">Hesap</span></span>
            <span className="text-[10px] uppercase tracking-widest bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-mono font-medium">ERP v2</span>
          </Link>
          <button onClick={() => setMobileMenuOpen(false)} className="lg:hidden text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <AccountMenu />

        {/* Navigation Menu */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700">
          {menuItems.map((item, idx) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragIdx !== null && dragIdx !== idx) moveModule(dragIdx, idx); setDragIdx(null); }}
                title="Sürükleyip sıralayabilirsiniz"
                onClick={() => setMobileMenuOpen(false)}
                data-testid={`nav-item-${item.path.replace('/', '') || 'dashboard'}`}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? item.isAi
                      ? "bg-gradient-to-r from-purple-600/90 to-indigo-600/90 text-white shadow-md shadow-purple-900/40"
                      : item.isSystem ? "bg-amber-500 text-slate-900 shadow-md shadow-amber-900/40" : "bg-emerald-600 text-white shadow-md shadow-emerald-950/40"
                    : item.isAi
                    ? "text-purple-300 hover:bg-purple-950/40 hover:text-white"
                    : item.isSystem ? "text-amber-300 hover:bg-amber-950/40 hover:text-white border border-amber-500/20 mt-2" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Icon className={`w-4 h-4 ${isActive ? (item.isSystem ? 'text-slate-900' : 'text-white') : item.isAi ? 'text-purple-400' : item.isSystem ? 'text-amber-400' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-semibold ${
                    isActive ? 'bg-white/20 text-white' : item.isAi ? 'bg-purple-500/20 text-purple-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User Card & Logout */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center font-bold text-xs text-white">
              {user?.name?.charAt(0) || "U"}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">{user?.name || "Kullanıcı"}</p>
              <p className="text-[10px] text-emerald-400 truncate">{user?.role_name || roleLabels[user?.role] || "Kullanıcı"}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition"
            title="Çıkış Yap"
            data-testid="logout-btn"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* Top Header */}
        <header className="h-16 bg-white border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-30 shadow-sm backdrop-blur-md bg-white/90">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
              data-testid="mobile-menu-toggle"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{activeCompany?.name}</span>
              <span>•</span>
              <LicenseBadge license={license} />
            </div>
          </div>

          {/* Quick Actions & Search */}
          <div className="flex items-center gap-2.5">
            <HeaderQuickActions companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
            <NotificationBell companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />
            {feature("header_barcode") && (<Link
              to="/stock?scan=true"
              className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition"
              data-testid="quick-barcode-scan-btn"
            >
              <QrCode className="w-4 h-4 md:w-3.5 md:h-3.5 text-indigo-600" />
              <span className="hidden md:inline">Barkod Oku</span>
            </Link>)}

            {feature("header_virman") && (<Link
              to="/banking?action=virman"
              className="hidden md:flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition"
              data-testid="quick-virman-btn"
            >
              <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-600" />
              <span>Virman</span>
            </Link>)}

            {feature("header_invoice") && (<Link
              to="/invoices?new=true"
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium shadow-sm shadow-emerald-600/30 transition"
              data-testid="quick-create-invoice-btn"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Yeni Fatura</span>
            </Link>)}

            {feature("header_ai") && (<Link
              to="/ai-advisor"
              className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium shadow-sm shadow-purple-600/30 transition"
              data-testid="quick-ai-btn"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">AI Danışman</span>
            </Link>)}
          </div>
        </header>

        {/* Page View Body */}
        {user?.impersonation && <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 bg-slate-900 text-amber-200 text-xs rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2" data-testid="impersonation-banner"><span><ShieldCheck className="inline w-3.5 h-3.5 mr-1" /> <b>Destek modu:</b> {activeCompany?.name} şirketine {user.impersonation.name || user.impersonation.by} tarafından girildi. Yaptığınız işlemler bu şirkete kaydedilir.</span><button onClick={exitImpersonation} className="px-3 py-1 bg-amber-400 text-slate-900 rounded-lg font-bold" data-testid="impersonation-exit">Destek modunu bitir</button></div>}
        {user && user.role !== "admin" && user.features && user.features.view_prices === false && <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl px-3 py-2" data-testid="prices-masked-banner">Rolünüz gereği fiyat, tutar ve bakiye bilgileri gizlenmiştir (0 olarak görünür).</div>}
        <main className={`flex-1 p-4 sm:p-6 lg:p-8 w-full mx-auto ${["/orders", "/stock"].some((p) => location.pathname.startsWith(p)) ? "max-w-[1680px]" : "max-w-7xl"}`}>
          {loading ? null : denied ? <div className="bg-white border rounded-2xl p-10 text-center text-slate-600" data-testid="access-denied"><div className="text-lg font-bold text-slate-900 mb-1">Bu modüle erişim yetkiniz yok</div><div className="text-sm">Rolünüz: {user?.role_name}. Yetki için yöneticinizle iletişime geçin.</div></div> : lockedModule ? <ModuleLockedPanel path={location.pathname} license={license} companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} /> : children}
        </main>
      </div>
    </div>
  );
}
