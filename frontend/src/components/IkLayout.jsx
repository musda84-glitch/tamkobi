import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { HelpButton } from "./help/HelpButton";
import { ikFieldDenied, portalFeatureKey, visibleIkLinks } from "../utils/portalFields";

/** Minimal self-service shell for ik.tamkobi.com (no MainLayout / panel menu). */
export default function IkLayout({ children }) {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const linkCls = (to) =>
    `px-3 py-2 text-sm font-medium rounded-md ${
      pathname === to || pathname.startsWith(to + "/")
        ? "bg-slate-800 text-white"
        : "text-slate-600 hover:bg-slate-100"
    }`;
  const links = visibleIkLinks(user);
  const denied = ikFieldDenied(pathname, user);
  const wide = Boolean(portalFeatureKey(pathname));

  return (
    <div className="min-h-screen bg-slate-50" data-testid="ik-layout">
      <header className="border-b bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-slate-900 tracking-tight shrink-0">TamKobi İK</span>
            <nav className="flex gap-1 ml-2 overflow-x-auto" data-testid="ik-nav">
              {links.map((link) => (
                <Link key={link.to} to={link.to} className={linkCls(link.to)} data-testid={`ik-nav-${link.to.slice(1)}`}>
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <HelpButton />
            <span className="hidden sm:inline truncate max-w-[12rem]">{user?.name || user?.email}</span>
            <button
              type="button"
              className="text-rose-600 hover:underline"
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
      </header>
      <main className={`${wide ? "max-w-7xl" : "max-w-3xl"} mx-auto px-4 py-6`}>
        {denied ? (
          <div className="bg-white border border-rose-200 rounded-xl p-6 text-sm text-rose-800" data-testid="ik-portal-denied">
            Bu özelliği kullanma yetkiniz yok. Firma yöneticisi Ayarlar → Roller ekranından açabilir.
          </div>
        ) : children}
      </main>
    </div>
  );
}
