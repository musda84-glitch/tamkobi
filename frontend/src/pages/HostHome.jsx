import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getHostKind } from "../utils/hosts";
import PricingPage from "./PricingPage";

/** Host-aware `/` — site marketing, app dashboard/login, b2b login, ik personelim. */
export default function HostHome() {
  const kind = getHostKind();
  const { authenticated, loading } = useAuth();

  if (kind === "site") return <PricingPage />;
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
