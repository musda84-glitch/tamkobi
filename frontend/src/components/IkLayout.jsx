import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { HelpButton } from "./help/HelpButton";
import { IkNavTabs } from "./IkPortalNav";
import { ikFieldDenied, portalFeatureKey, visibleIkLinks } from "../utils/portalFields";

/** Minimal self-service shell for ik.tamkobi.com (no MainLayout / panel menu). */
export default function IkLayout({ children }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const links = visibleIkLinks(user);
  const denied = ikFieldDenied(pathname, user);
  const wide = Boolean(portalFeatureKey(pathname));

  return (
    <div className="min-h-screen bg-slate-50 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0" data-testid="ik-layout">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl flex-nowrap items-center justify-between gap-3 px-4">
          <span className="shrink-0 font-semibold tracking-tight text-slate-900">TamKobi İK</span>
          <div className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
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
