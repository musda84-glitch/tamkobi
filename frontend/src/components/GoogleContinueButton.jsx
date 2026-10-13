import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";
import { LegalConsent, emptyLegalConsent, legalPayload } from "./LegalConsent";

export const GOOGLE_CLIENT_ID = (process.env.REACT_APP_GOOGLE_CLIENT_ID || "").trim();

const GIS_SRC = "https://accounts.google.com/gsi/client";

function loadGisScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.google?.accounts?.id) return Promise.resolve();
  const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      if (window.google?.accounts?.id) resolve();
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/**
 * Google ile devam et — GIS One Tap / button.
 * onSuccess(data): oturum açıldı veya kayıt tamamlandı.
 * needs_profile → kısa form (şirket + telefon).
 */
export function GoogleContinueButton({
  onSuccess,
  onNeedsProfile,
  remember = true,
  mode = "login",
  className = "",
  testId = "google-continue",
}) {
  const btnRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(null); // needs_profile payload
  const [form, setForm] = useState({ company_name: "", phone: "" });
  const [consent, setConsent] = useState(emptyLegalConsent());

  const handleCredential = useCallback(async (credential, extra = {}) => {
    setBusy(true);
    try {
      const body = {
        remember: !!remember,
        ...extra,
      };
      if (extra.pending_token) body.pending_token = extra.pending_token;
      else body.credential = credential;
      const r = await axios.post(`${API_URL}/auth/google`, body, { withCredentials: true });
      const data = r.data || {};
      if (data.needs_profile) {
        setProfile(data);
        onNeedsProfile?.(data);
        return data;
      }
      if (data.requires_2fa) {
        toast.message("İki adımlı doğrulama gerekli.");
        onSuccess?.(data);
        return data;
      }
      toast.success(data.message || `Hoş geldiniz${data.user?.name ? `, ${data.user.name}` : ""}`);
      onSuccess?.(data);
      return data;
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.detail || "Google ile devam edilemedi.";
      if (status === 404) {
        toast.error("Google girişi bu ortamda kapalı.");
      } else {
        toast.error(typeof msg === "string" ? msg : "Google ile devam edilemedi.");
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [remember, onSuccess, onNeedsProfile]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return undefined;
    let cancelled = false;
    loadGisScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp) => {
            if (resp?.credential) handleCredential(resp.credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        if (btnRef.current) {
          btnRef.current.innerHTML = "";
          window.google.accounts.id.renderButton(btnRef.current, {
            theme: mode === "signup" ? "filled_black" : "outline",
            size: "large",
            text: "continue_with",
            shape: "pill",
            width: 320,
            locale: "tr",
          });
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) toast.error("Google kimlik servisi yüklenemedi.");
      });
    return () => { cancelled = true; };
  }, [handleCredential, mode]);

  const completeProfile = async (e) => {
    e.preventDefault();
    if (!profile?.pending_token) return;
    await handleCredential(null, {
      pending_token: profile.pending_token,
      company_name: form.company_name,
      phone: form.phone,
      name: profile.name,
      ...legalPayload(consent),
    });
  };

  if (!GOOGLE_CLIENT_ID) return null;

  if (profile) {
    return (
      <form
        onSubmit={completeProfile}
        className={`space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 ${className}`}
        data-testid={`${testId}-profile`}
      >
        <div className="text-sm font-semibold text-slate-800">Hesabı tamamlayın</div>
        <p className="text-xs text-slate-500">
          Google hesabınız: <b>{profile.email}</b>. Şirket adı ve telefon gerekli.
        </p>
        <div>
          <label className="block text-xs font-semibold mb-1">Şirket adı *</label>
          <input
            required
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
            className="w-full border rounded-xl p-2.5 text-sm bg-white"
            data-testid={`${testId}-company`}
            placeholder="Örn. Yıldız Mobilya Ltd. Şti."
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">Telefon *</label>
          <input
            required
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="w-full border rounded-xl p-2.5 text-sm bg-white"
            data-testid={`${testId}-phone`}
            placeholder="05xx xxx xx xx"
          />
        </div>
        <LegalConsent value={consent} onChange={setConsent} prefix={`${testId}-`} className="text-slate-600" />
        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm disabled:opacity-60"
          data-testid={`${testId}-profile-submit`}
        >
          {busy ? "Kaydediliyor…" : "Kaydı tamamla"}
        </button>
        <button
          type="button"
          onClick={() => setProfile(null)}
          className="w-full text-[11px] text-slate-500"
          data-testid={`${testId}-profile-cancel`}
        >
          Vazgeç
        </button>
      </form>
    );
  }

  return (
    <div className={`space-y-2 ${className}`} data-testid={testId}>
      <div ref={btnRef} className="flex justify-center min-h-[44px]" data-testid={`${testId}-btn`} />
      {!ready || busy ? (
        <p className="text-[10px] text-center text-slate-400">
          {busy ? "Google ile devam ediliyor…" : "Google yükleniyor…"}
        </p>
      ) : null}
    </div>
  );
}

export default GoogleContinueButton;
