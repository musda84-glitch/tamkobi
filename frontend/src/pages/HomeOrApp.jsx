import React from "react";
import { useAuth } from "../context/AuthContext";
import Dashboard from "./Dashboard";
import PricingPage from "./PricingPage";

export default function HomeOrApp() {
  const { authenticated, loading } = useAuth();
  if (loading) {
    return <div className="min-h-screen bg-[#0b0f1a] text-slate-400 flex items-center justify-center text-xs" data-testid="site-loading">Yükleniyor…</div>;
  }
  return authenticated ? <Dashboard /> : <PricingPage />;
}
