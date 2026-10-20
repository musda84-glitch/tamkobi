import React, { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useMesaimGate } from "../context/MesaimGateContext";
import { mesaimExclusivePathAllowed } from "../utils/attendanceSelf";
import { bindMesaimLockedInterceptor } from "../utils/mesaimLockClient";
import { HelpButton } from "./help/HelpButton";
import { IkNavTabs } from "./IkPortalNav";
import { NotificationBell } from "./NotificationBell";
import { ikFieldDenied, portalFeatureKey, visibleIkLinks } from "../utils/portalFields";

/** Minimal self-service shell for ik.tamkobi.com (no MainLayout / panel menu). */
export default function IkLayout({ children }) {
  const { pathname } = useLocation();
  const { user, logout, activeCompany } = useAuth();
  const { locked: mesaimLocked, ready: mesaimReady, refresh } = useMesaimGate();
  const companyId = activeCompany?.id || activeCompany?._id || user?.active_company_id || "";
  const navigate = useNavigate();
  useEffect(() => bindMesaimLockedInterceptor(axios, refresh), [refresh]);
  const links = visibleIkLinks(user, { mesaimLocked: Boolean(mesaimReady && mesaimLocked) });
  const denied = ikFieldDenied(pathname, user);
  const wide = Boolean(portalFeatureKey(pathname));
  const onMesai = pathname === "/mesai" || pathname.startsWith("/mesai/");

  if (user?.employee_id && !mesaimReady) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-400 flex items-center justify-center text-xs" data-testid="ik-auth-loading">
        Yükleniyor…
      </div>
    );
  }
  if (mesaimReady && mesaimLocked && !mesaimExclusivePathAllowed(pathname)) {
    return <Navigate to="/mesai" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0" data-testid="ik-layout">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl flex-nowrap items-center justify-between gap-3 px-4">
          <span className="shrink-0 font-semibold tracking-tight text-slate-900">TamKobi İK</span>
          <div className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
            {companyId ? <NotificationBell companyId={companyId} /> : null}
            <HelpButton />
            <span className="hidden max-w-[12rem] truncate sm:inline">{user?.name || user?.email}</span>
            <button
              type="button"
              className="shrink-0 whitespace-nowrap text-rose-600 hover:underline"
              onClick={async () => {
                try {
                  await logout?.();
                } catch {
                  /* ignore */
                }
                navigate("/login");
              }}
            >
              Çıkış
            </button>
          </div>
        </div>
        <IkNavTabs links={links} pathname={pathname} variant="desktop" />
      </header>
      <main className={`${wide ? "max-w-7xl" : "max-w-3xl"} mx-auto px-4 py-6`}>
        {mesaimLocked && onMesai ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="mesaim-locked-banner">
            Mesai çıkışı yapıldı. Diğer ekranlar bir sonraki mesai girişinize kadar kapalı.
          </div>
        ) : null}
        {denied ? (
          <div className="bg-white border border-rose-200 rounded-xl p-6 text-sm text-rose-800" data-testid="ik-portal-denied">
            Bu özelliği kullanma yetkiniz yok. Firma yöneticisi Ayarlar → Roller ekranından açabilir.
          </div>
        ) : children}
      </main>
      <IkNavTabs links={links} pathname={pathname} variant="mobile" />
    </div>
  );
}
