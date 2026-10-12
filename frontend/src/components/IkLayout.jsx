import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

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

  return (
    <div className="min-h-screen bg-slate-50" data-testid="ik-layout">
      <header className="border-b bg-white">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 tracking-tight">TamKobi İK</span>
            <nav className="flex gap-1 ml-4">
              <Link to="/personelim" className={linkCls("/personelim")}>
                Personelim
              </Link>
              <Link to="/mesai" className={linkCls("/mesai")}>
                Mesaim
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
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
      <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
