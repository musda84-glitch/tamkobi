import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle, Clock } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export default function PaymentResultPage() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const sessionId = params.get("session_id") || params.get("merchant_oid");
  const [st, setSt] = useState(null);
  const [tries, setTries] = useState(0);
  const cancelled = pathname.endsWith("/iptal");
  useEffect(() => {
    if (cancelled || !sessionId) return undefined;
    let n = 0; let stop = false;
    const poll = async () => {
      if (stop) return;
      try { const r = await axios.get(`${API_URL}/payments/status/${sessionId}`); setSt(r.data); if (r.data.payment_status === "paid" || ["expired", "failed"].includes(r.data.payment_status)) stop = true; } catch { /* retry */ }
      n += 1; setTries(n);
      if (!stop && n < 15) setTimeout(poll, 2000);
    };
    poll();
    return () => { stop = true; };
  }, [sessionId, cancelled]);
  const paid = st?.payment_status === "paid";
  const failed = st && ["expired", "failed"].includes(st.payment_status);
  const timeout = !paid && !failed && tries >= 15;
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 text-center space-y-4" data-testid="payment-result">
        {cancelled ? (<><XCircle className="w-14 h-14 mx-auto text-slate-400" /><h1 className="text-xl font-bold text-slate-900">Ödeme iptal edildi</h1><p className="text-sm text-slate-500">Herhangi bir ücret alınmadı. Dilediğiniz zaman tekrar deneyebilirsiniz.</p></>)
          : paid && st.product_type === "gib_credits" ? (<><CheckCircle2 className="w-14 h-14 mx-auto text-emerald-500" /><h1 className="text-xl font-bold text-slate-900" data-testid="payment-success-title">Ödeme alındı, kontör yüklendi!</h1><p className="text-sm text-slate-600"><b>{st.plan_name}</b> — {Number(st.credits || 0).toLocaleString("tr-TR")} GİB kontörü hesabınıza eklendi. Güncel bakiye: {Number(st.credits_balance ?? 0).toLocaleString("tr-TR")}. Tutar: {Number(st.amount).toLocaleString("tr-TR")} {String(st.currency).toUpperCase()}.</p></>)
          : paid ? (<><CheckCircle2 className="w-14 h-14 mx-auto text-emerald-500" /><h1 className="text-xl font-bold text-slate-900" data-testid="payment-success-title">Ödeme alındı, paketiniz aktif!</h1><p className="text-sm text-slate-600"><b>{st.plan_name}</b> paketi ({st.period === "yearly" ? "yıllık" : "aylık"}) {st.license?.expires_at ? `${new Date(st.license.expires_at).toLocaleDateString("tr-TR")} tarihine kadar` : ""} aktif edildi. Tutar: {Number(st.amount).toLocaleString("tr-TR")} {String(st.currency).toUpperCase()}.{st.invoice_number ? ` e-Arşiv faturanız (${st.invoice_number}) e-posta adresinize gönderildi.` : ""}</p></>)
          : failed ? (<><XCircle className="w-14 h-14 mx-auto text-rose-500" /><h1 className="text-xl font-bold text-slate-900">Ödeme tamamlanamadı</h1><p className="text-sm text-slate-500">Oturum süresi doldu ya da ödeme reddedildi. Lütfen tekrar deneyin.</p></>)
          : timeout ? (<><Clock className="w-14 h-14 mx-auto text-amber-500" /><h1 className="text-xl font-bold text-slate-900">Ödeme kontrol ediliyor</h1><p className="text-sm text-slate-500">Ödemeniz henüz onaylanmadı. Birkaç dakika içinde paketiniz otomatik aktif olacaktır; e-posta ile bilgilendirileceksiniz.</p></>)
          : (<><Loader2 className="w-14 h-14 mx-auto text-indigo-500 animate-spin" /><h1 className="text-xl font-bold text-slate-900">Ödemeniz doğrulanıyor…</h1><p className="text-sm text-slate-500">Lütfen sayfayı kapatmayın.</p></>)}
        <div className="flex flex-wrap gap-2 justify-center pt-2">{paid && st.invoice_id && <a href={`${API_URL}/invoices/${st.invoice_id}/pdf`} target="_blank" rel="noreferrer" className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold" data-testid="payment-invoice-pdf">Fatura PDF</a>}{paid && st.product_type === "gib_credits" ? <Link to="/hesap?tab=kontor" className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold" data-testid="payment-go-gib">GİB Kontör</Link> : <Link to="/hesap?tab=paket" className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold" data-testid="payment-go-plan">Paketim & Modüller</Link>}<Link to="/" className="px-4 py-2 border rounded-xl text-xs font-semibold" data-testid="payment-go-home">Ana Sayfa</Link></div>
      </div>
    </div>
  );
}
