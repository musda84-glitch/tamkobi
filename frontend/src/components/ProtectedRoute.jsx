import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function isPublicPath(pathname) {
  const p = pathname || "/";
  if (p === "/" || p === "/login") return true;
  if (p === "/sistem" || p.startsWith("/sistem/")) return true;
  if (p === "/b2b" || p.startsWith("/b2b/")) return true;
  return (
    p.startsWith("/fiyatlar") ||
    p.startsWith("/kayit") ||
    p.startsWith("/portal/") ||
    p.startsWith("/teklif/") ||
    p.startsWith("/davet/") ||
    p.startsWith("/odeme/") ||
    p.startsWith("/yenile/")
  );
}

/** ERP shell routes require a real session (no demo-admin fallback). */
export default function ProtectedRoute({ children }) {
  const { authenticated, loading } = useAuth();
  const location = useLocation();
  if (isPublicPath(location.pathname)) return children;
  if (loading) {
    return <div className="min-h-screen bg-slate-50 text-slate-400 flex items-center justify-center text-xs">Yükleniyor…</div>;
  }
  if (!authenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
