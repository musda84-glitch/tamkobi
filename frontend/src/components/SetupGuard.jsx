import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import axios from "axios";
import { API_URL } from "../api/client";

export default function SetupGuard({ children }) {
  const location = useLocation();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API_URL}/setup/status`)
      .then((r) => {
        if (!cancelled) setStatus(r.data || { installed: false });
      })
      .catch(() => {
        if (!cancelled) setStatus({ installed: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) {
    return (
      <div className="min-h-screen bg-[#0b0f1a] text-slate-400 flex items-center justify-center text-xs" data-testid="setup-guard-loading">
        Yükleniyor…
      </div>
    );
  }
  if (!status.installed && location.pathname !== "/kurulum") {
    return <Navigate to="/kurulum" replace />;
  }
  return children;
}
