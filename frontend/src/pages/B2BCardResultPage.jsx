import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";
import { REASONS } from "./VposResultPage";

const STATUS = {
  paid: { title: "Ödeme alındı", testid: "b2b-card-result-paid" },
  failed: { title: "Ödeme başarısız", testid: "b2b-card-result-failed" },
  expired: { title: "Ödeme süresi doldu", testid: "b2b-card-result-expired" },
  pending: { title: "Ödeme bekleniyor", testid: "b2b-card-result-pending" },
  processing: { title: "Ödeme işleniyor", testid: "b2b-card-result-processing" },
};

export default function B2BCardResultPage() {
  const { token, intentId } = useParams();
  const [row, setRow] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let tries = 0;
    setRow(null);
    setMissing(false);
    const load = () => {
      axios.get(`${API_URL}/public/b2b/${token}/card-payments/${intentId}`)
        .then((res) => {
          if (cancelled) return;
          const data = res.data || null;
          setRow(data);
          if (data?.status === "paid" && data?.order_number && token) {
            try { localStorage.removeItem(`b2b_cart_${token}`); } catch { /* sepet zaten yok */ }
          }
          const status = data?.status || "";
          if ((status === "pending" || status === "processing") && tries < 4) {
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
  }, [token, intentId]);

  if (missing) {
    return <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-2xl p-6 text-sm" data-testid="b2b-card-result-missing">Ödeme bulunamadı.</div>;
  }
  if (!row) {
    return <div className="text-xs text-slate-400 p-6" data-testid="b2b-card-result-loading">Yükleniyor…</div>;
  }
  const view = STATUS[row.status] || STATUS.pending;
  const result = row.result || {};
  const reason = REASONS[result.error] || "";
  const charge = formatTrAmount(Number(row.charge_amount || 0));
  return (
    <div className="max-w-lg mx-auto bg-white border border-slate-200 rounded-2xl p-6 space-y-3" data-testid="b2b-card-result">
      <h1 className="text-lg font-bold text-slate-900" data-testid={view.testid}>{view.title}</h1>
      <p className="text-sm text-slate-600" data-testid="b2b-card-result-amount">{charge} ₺</p>
      {row.status === "paid" && (
        <p className="text-sm text-emerald-800" data-testid="b2b-card-result-balance">
          Yeni bakiye: {formatTrAmount(Number(row.balance || 0))} ₺
        </p>
      )}
      {row.status === "paid" && row.order_number ? (
        <p className="text-sm text-emerald-800" data-testid="b2b-card-result-order">Siparişiniz alındı: {row.order_number}</p>
      ) : null}
      {row.status === "paid" && row.order_error && !row.order_number ? (
        <p className="text-sm text-amber-900" data-testid="b2b-card-result-review">Ödemeniz alındı, siparişiniz firma onayında.</p>
      ) : null}
      {reason && <p className="text-sm text-slate-700" data-testid="b2b-card-result-reason">{reason}</p>}
      <Link to={`/portal/${token}`} className="text-sm font-semibold text-emerald-700 underline" data-testid="b2b-card-result-back">Portala dön</Link>
    </div>
  );
}
