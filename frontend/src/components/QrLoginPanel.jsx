import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { QRCodeSVG } from "qrcode.react";
import { QrCode, RefreshCw, ArrowLeft } from "lucide-react";
import { API_URL } from "../context/AuthContext";

function detailOf(err, fallback) {
  const detail = err?.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

function leftLabel(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function QrLoginPanel({ remember, onSuccess, onBack }) {
  const [view, setView] = useState("loading");
  const [code, setCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [left, setLeft] = useState(0);
  const [gen, setGen] = useState(0);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    let stop = false;
    let timer = null;
    setView("loading");
    setCode("");
    setError("");
    const tick = async (nextCode, pollSecret) => {
      if (stop) return;
      try {
        const st = await axios.post(
          `${API_URL}/auth/qr-login/status`,
          { code: nextCode, poll_secret: pollSecret },
          { withCredentials: true },
        );
        if (stop) return;
        const status = st.data?.status;
        if (status === "approved" && (st.data?.user || st.data?.token || st.data?.redirect)) {
          stop = true;
          onSuccessRef.current(st.data);
          return;
        }
        if (status === "expired") {
          setView("expired");
          return;
        }
        if (status === "rejected") {
          setView("rejected");
          return;
        }
        if (status === "consumed") {
          setView("error");
          setError("Bu QR zaten kullanıldı. Yenileyin.");
          return;
        }
        timer = setTimeout(() => tick(nextCode, pollSecret), 2000);
      } catch (err) {
        if (stop) return;
        if (err?.response?.status === 429) {
          setView("error");
          setError(detailOf(err, "Çok fazla deneme. Biraz sonra yenileyin."));
          return;
        }
        timer = setTimeout(() => tick(nextCode, pollSecret), 2000);
      }
    };
    (async () => {
      try {
        const r = await axios.post(
          `${API_URL}/auth/qr-login/start`,
          { remember: !!remember },
          { withCredentials: true },
        );
        if (stop) return;
        const nextCode = String(r.data?.code || "");
        const pollSecret = String(r.data?.poll_secret || "");
        setCode(nextCode);
        setExpiresAt(r.data?.expires_at || "");
        setView("pending");
        await tick(nextCode, pollSecret);
      } catch (err) {
        if (stop) return;
        setView("error");
        setError(detailOf(err, "QR oluşturulamadı."));
      }
    })();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [gen, remember]);

  useEffect(() => {
    if (view !== "pending" || !expiresAt) return undefined;
    const update = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [view, expiresAt]);

  const refresh = () => setGen((n) => n + 1);

  return (
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 sm:p-8 space-y-4" data-testid="login-qr-panel">
      <div className="flex items-center gap-2 text-slate-900">
        <QrCode className="w-5 h-5 text-emerald-600" />
        <div className="text-sm font-bold">QR ile giriş</div>
      </div>
      <p className="text-xs text-slate-500">
        Telefondaki TamKobi uygulamasından bu kodu okutun. Onaylayınca bu tarayıcıda oturum açılır.
      </p>
      {view === "loading" ? (
        <div className="text-sm text-slate-500 text-center py-10" data-testid="login-qr-wait">QR hazırlanıyor…</div>
      ) : null}
      {view === "pending" && code ? (
        <div className="space-y-3">
          <div className="flex justify-center" data-testid="login-qr-code">
            <div className="bg-white p-2 rounded-xl border border-slate-200">
              <QRCodeSVG value={code} size={188} level="M" includeMargin={false} />
            </div>
          </div>
          <div className="text-center text-sm font-semibold text-slate-800" data-testid="login-qr-wait">Onay bekleniyor</div>
          <div className="text-center text-xs text-slate-500" data-testid="login-qr-countdown">Kalan süre {leftLabel(left)}</div>
          <button type="button" onClick={refresh} className="w-full text-[11px] text-emerald-700 font-semibold" data-testid="login-qr-refresh">
            Kodu yenile
          </button>
        </div>
      ) : null}
      {view === "expired" ? (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="login-qr-status">
          Süre doldu. Yeni bir kod üretin.
        </div>
      ) : null}
      {view === "rejected" ? (
        <div className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="login-qr-status">
          Giriş reddedildi.
        </div>
      ) : null}
      {view === "error" ? (
        <div className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" data-testid="login-qr-error">{error}</div>
      ) : null}
      {view !== "loading" && view !== "pending" ? (
        <button type="button" onClick={refresh} className="w-full py-2.5 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2" data-testid="login-qr-refresh-again">
          <RefreshCw className="w-4 h-4" /> Yenile
        </button>
      ) : null}
      <button type="button" onClick={onBack} className="w-full text-[11px] text-slate-500 flex items-center justify-center gap-1" data-testid="login-qr-back">
        <ArrowLeft className="w-3 h-3" /> Şifre ile giriş
      </button>
    </div>
  );
}
