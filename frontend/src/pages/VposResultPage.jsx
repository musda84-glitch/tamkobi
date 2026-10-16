import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

const STATUS = {
  paid: { title: "Ödeme alındı", testid: "vpos-result-paid" },
  failed: { title: "Ödeme başarısız", testid: "vpos-result-failed" },
  expired: { title: "Ödeme süresi doldu", testid: "vpos-result-expired" },
  pending: { title: "Ödeme bekleniyor", testid: "vpos-result-pending" },
  processing: { title: "Ödeme işleniyor", testid: "vpos-result-processing" },
};

const REASONS = {
  amount_mismatch: "Tutar doğrulanamadı.",
  currency_mismatch: "Para birimi doğrulanamadı.",
  order_mismatch: "Sipariş numarası doğrulanamadı.",
  bad_hash: "Banka imzası doğrulanamadı.",
  declined: "Banka işlemi onaylamadı.",
  expired: "Süre doldu.",
  company_mismatch: "Ödeme kaydı doğrulanamadı.",
  config: "Sanal POS ayarı doğrulanamadı.",
  token_failed: "Ödeme başlatılamadı.",
  init_failed: "Ödeme başlatılamadı.",
  bad_signature: "Ödeme yanıtı doğrulanamadı.",
  conversation_mismatch: "Ödeme kaydı doğrulanamadı.",
};

function maskedPan(value) {
  return /^\d{6}\*{4,}\d{4}$/.test(String(value || "")) ? String(value) : "";
}

export default function VposResultPage() {
  const { id } = useParams();
  const [intent, setIntent] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let tries = 0;
    setIntent(null);
    setMissing(false);
    const load = () => {
      axios.get(`${API_URL}/vpos/intents/${id}`)
        .then((res) => {
          if (cancelled) return;
          const data = res.data || null;
          setIntent(data);
          if (data && data.status === "pending" && tries < 4) {
            tries += 1;
            timer = setTimeout(load, 800);
          }
        })
        .catch(() => {
          if (!cancelled && tries === 0) setMissing(true);
        });
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  if (missing) {
    return <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-2xl p-6 text-sm" data-testid="vpos-result-missing">Ödeme bulunamadı.</div>;
  }
  if (!intent) {
    return <div className="text-xs text-slate-400 p-6" data-testid="vpos-result-loading">Yükleniyor…</div>;
  }
  const view = STATUS[intent.status] || STATUS.pending;
  const result = intent.result || {};
  const pan = maskedPan(result.masked_pan);
  const reason = REASONS[result.error] || "";
  return (
    <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-2xl p-6 space-y-3" data-testid="vpos-result">
      <h1 className="text-lg font-bold text-slate-900" data-testid={view.testid}>{view.title}</h1>
      <p className="text-sm text-slate-600" data-testid="vpos-result-amount">{intent.amount} {intent.currency || "TRY"}</p>
      {intent.purpose === "test" && <p className="text-xs text-slate-500" data-testid="vpos-result-test-note">Bu bir test ödemesidir. Kasa ve cari hesaba işlenmez.</p>}
      {reason && <p className="text-sm text-slate-700" data-testid="vpos-result-reason">{reason}</p>}
      {result.auth_code && <p className="text-sm" data-testid="vpos-result-auth">Onay kodu: {result.auth_code}</p>}
      {pan && <p className="text-sm" data-testid="vpos-result-pan">Kart: {pan}</p>}
    </div>
  );
}
