import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getHostKind } from "../utils/hosts";
import { isSitePreviewSearch, marketingSlugFromLocation } from "../utils/marketingSite";
import PricingPage from "./PricingPage";
import TaiSite from "./TaiSite";

/** Host-aware `/` — site marketing, app dashboard/login, b2b login, ik personelim. */
export default function HostHome() {
  const kind = getHostKind();
  const { authenticated, loading } = useAuth();

  const preview = typeof window !== "undefined" && isSitePreviewSearch(window.location.search);
  if (kind === "site" || (kind === "ynt" && preview)) {
    return marketingSlugFromLocation() === "tai" ? <TaiSite page="home" /> : <PricingPage />;
  }
  if (kind === "b2b") return <Navigate to="/b2b/giris" replace />;
  if (kind === "ik") {
    if (loading) return null;
    return authenticated ? <Navigate to="/personelim" replace /> : <Navigate to="/login" replace />;
  }
  // app
  if (loading) return null;
  if (!authenticated) return <Navigate to="/login" replace />;
  return <Navigate to="/panel" replace />;
}
