import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";

const money = (n) => formatTrAmount(n || 0);

function Drift({ value }) {
  const n = Number(value) || 0;
  const off = Math.abs(n) >= 0.01;
  return <span className={off ? "text-rose-700 font-bold" : "text-emerald-700"}>{money(n)}</span>;
}

export function ReconciliationPanel({ companyId }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await axios.get(`${API_URL}/banking/reconciliation`, { params: { company_id: companyId } });
      setReport(r.data);
    } catch (err) {
      setReport(null);
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Mutabakat raporu okunamadı.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const summary = report?.summary || {};

  return (
    <div className="space-y-4" data-testid="reconciliation-panel">
      {loading && <div className="text-sm text-slate-500">Mutabakat yükleniyor…</div>}
      {!loading && error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-4">{error}</div>}
      {!loading && !error && report && <>
      <div className="text-xs text-slate-500">Salt okuma. Gösterilen bakiye ile hareket toplamı; bankanın bildirdiği tutar ayrıdır. Hiçbir kayıt değiştirilmez.</div>
      <div className="text-xs font-semibold text-slate-700" data-testid="reconciliation-summary">
        Hesap farkı {summary.account_drift || 0}/{summary.account_count || 0}
        {" · "}Ortak farkı {summary.partner_drift || 0}/{summary.partner_count || 0}
        {" · "}Cari farkı {summary.contact_drift || 0}/{summary.contact_count || 0}
      </div>
      <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
        <table className="w-full text-xs">
          <thead className="text-slate-500 uppercase text-[10px]">
            <tr>
              <th className="text-left p-2">Hesap</th>
              <th className="text-left p-2">Tür</th>
              <th className="text-right p-2">Gösterilen</th>
              <th className="text-right p-2">Hareket</th>
              <th className="text-right p-2">Banka</th>
              <th className="text-right p-2">Fark</th>
            </tr>
          </thead>
          <tbody>
            {(report.accounts || []).map((row) => (
              <tr key={row.id} className="border-t border-slate-100" data-testid={`recon-account-${row.id}`}>
                <td className="p-2">{row.ad}{row.entegre_mi ? " · entegre" : ""}</td>
                <td className="p-2">{row.tur}</td>
                <td className="p-2 text-right">{money(row.gosterilen)}</td>
                <td className="p-2 text-right">{money(row.hareket_toplami)}</td>
                <td className="p-2 text-right">{row.banka_bildirdigi == null ? "—" : money(row.banka_bildirdigi)}</td>
                <td className="p-2 text-right"><Drift value={row.fark} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
        <table className="w-full text-xs">
          <thead className="text-slate-500 uppercase text-[10px]">
            <tr>
              <th className="text-left p-2">Ortak</th>
              <th className="text-right p-2">Kart</th>
              <th className="text-right p-2">Lehine</th>
              <th className="text-right p-2">Aleyhine</th>
              <th className="text-right p-2">Fark</th>
            </tr>
          </thead>
          <tbody>
            {(report.partners || []).map((row) => (
              <tr key={row.id} className="border-t border-slate-100" data-testid={`recon-partner-${row.id}`}>
                <td className="p-2">{row.ad}</td>
                <td className="p-2 text-right">{money(row.kart_bakiyesi)}</td>
                <td className="p-2 text-right">{money(row.liste_lehine)}</td>
                <td className="p-2 text-right">{money(row.liste_aleyhine)}</td>
                <td className="p-2 text-right"><Drift value={row.fark} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
        <table className="w-full text-xs">
          <thead className="text-slate-500 uppercase text-[10px]">
            <tr>
              <th className="text-left p-2">Cari</th>
              <th className="text-right p-2">Kayıtlı</th>
              <th className="text-right p-2">Hesaplanan</th>
              <th className="text-right p-2">Fark</th>
            </tr>
          </thead>
          <tbody>
            {(report.contacts || []).filter((row) => Math.abs(Number(row.fark) || 0) >= 0.01).slice(0, 200).map((row) => (
              <tr key={row.id} className="border-t border-slate-100" data-testid={`recon-contact-${row.id}`}>
                <td className="p-2">{row.ad}</td>
                <td className="p-2 text-right">{money(row.kayitli)}</td>
                <td className="p-2 text-right">{money(row.hesaplanan)}</td>
                <td className="p-2 text-right"><Drift value={row.fark} /></td>
              </tr>
            ))}
            {(report.contacts || []).every((row) => Math.abs(Number(row.fark) || 0) < 0.01) && (
              <tr><td className="p-2 text-slate-400" colSpan={4}>Cari farkı yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}
