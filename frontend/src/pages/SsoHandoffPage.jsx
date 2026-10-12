import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_URL } from "../api/client";

/** Consumes one-time SSO code and sets host-only cookies via /api/auth/sso-exchange. */
export default function SsoHandoffPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [err, setErr] = useState("");

  useEffect(() => {
    const code = params.get("code");
    const next = params.get("next") || "";
    if (!code) {
      setErr("Eksik kod");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/auth/sso-exchange`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(body.detail || "SSO başarısız");
        }
        if (cancelled) return;
        const dest = next || body.redirect || "/panel";
        window.location.replace(dest);
      } catch (e) {
        if (!cancelled) setErr(e.message || "SSO başarısız");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, navigate]);

  if (err) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-rose-600 text-sm">
        {err}
      </div>
    );
  }
  return (
    <div className="min-h-[40vh] flex items-center justify-center text-slate-500 text-sm">
      Oturum aktarılıyor…
    </div>
  );
}
