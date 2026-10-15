import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";
import { backdropDismissProps } from "../utils/modalBackdrop";

const money = (n) => formatTrAmount(n || 0);

function Drift({ value }) {
  const n = Number(value) || 0;
  const off = Math.abs(n) >= 0.01;
  return <span className={off ? "text-rose-700 font-bold" : "text-emerald-700"}>{money(n)}</span>;
}

function canSaveOpening(row) {
  return Math.abs(Number(row?.fark) || 0) >= 0.01 && !row?.acilis_var;
}

export function ReconciliationPanel({ companyId }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openingRow, setOpeningRow] = useState(null);
  const [savingOpening, setSavingOpening] = useState(false);

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

  const confirmOpening = async () => {
    if (!openingRow || savingOpening) return;
    setSavingOpening(true);
    try {
      await axios.post(`${API_URL}/banking/accounts/${openingRow.id}/opening-balance`);
      toast.success("Fark açılış bakiyesi olarak kaydedildi. Gösterilen bakiye değişmedi.");
      setOpeningRow(null);
      await load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      const message = typeof detail === "string" ? detail : "Açılış bakiyesi kaydedilemedi.";
      toast.error(message);
      if (err.response?.status === 409) {
        setOpeningRow(null);
        await load();
      }
    } finally {
      setSavingOpening(false);
    }
  };

  const summary = report?.summary || {};
  const warnings = report?.uyarilar || [];

  return (
    <div className="space-y-4" data-testid="reconciliation-panel">
      {loading && <div className="text-sm text-slate-500">Mutabakat yükleniyor…</div>}
      {!loading && error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-4">{error}</div>}
      {!loading && !error && report && <>
      <div className="text-xs text-slate-500">Gösterilen bakiye ile hareket toplamı; bankanın bildirdiği tutar ayrıdır. Eşleşmemiş banka hareketleri bakiyeye dahildir.</div>
      {warnings.length > 0 && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1" data-testid="recon-duplicate-warning">
          {warnings.map((w) => <div key={`${w.tur}-${w.anahtar}`}>{w.mesaj}</div>)}
        </div>
      )}
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
              <th className="text-right p-2" title="source=bank_sync ve eşleşmemiş. Bakiyeye dahildir.">Eşleşmemiş banka hareketi</th>
              <th className="text-right p-2" title="Bankanın bildirdiği bakiye − hareket toplamı">Banka farkı</th>
              <th className="text-right p-2"></th>
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
                <td className="p-2 text-right" data-testid={`recon-unmatched-${row.id}`}>
                  {Number(row.eslesmemis_adet) > 0 ? `${row.eslesmemis_adet} · ${money(row.eslesmemis_tutar)}` : "0"}
                </td>
                <td className="p-2 text-right" data-testid={`recon-bank-diff-${row.id}`}>
                  {row.banka_farki == null ? "—" : <Drift value={row.banka_farki} />}
                </td>
                <td className="p-2 text-right">
                  {canSaveOpening(row) && (
                    <button
                      type="button"
                      className="text-[10px] font-semibold text-indigo-700 hover:underline"
                      data-testid={`recon-save-opening-${row.id}`}
                      onClick={() => setOpeningRow(row)}
                    >
                      Farkı açılış bakiyesi olarak kaydet
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-slate-500 px-3 py-2" data-testid="recon-unmatched-note">Eşleşmemiş banka hareketleri bakiyeye dahildir.</p>
      </div>
      {openingRow && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" data-testid="recon-opening-modal" {...backdropDismissProps(() => { if (!savingOpening) setOpeningRow(null); })}>
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900">Farkı açılış bakiyesi olarak kaydet</h3>
            <p className="text-xs text-slate-600">
              {openingRow.ad}: {money(openingRow.fark)} tutarındaki fark, ilk hareketten bir gün öncesine açılış hareketi olarak yazılacak.
              Gösterilen bakiye değişmez.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-1.5 text-xs border rounded-lg" data-testid="recon-opening-cancel" disabled={savingOpening} onClick={() => setOpeningRow(null)}>Vazgeç</button>
              <button type="button" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg disabled:opacity-50" data-testid="recon-opening-confirm" disabled={savingOpening} onClick={confirmOpening}>
                {savingOpening ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
        <table className="w-full text-xs">
          <thead className="text-slate-500 uppercase text-[10px]">
            <tr>
              <th className="text-left p-2">Ortak</th>
              <th className="text-right p-2">Kart</th>
              <th className="text-right p-2">Kayıtlı</th>
              <th className="text-right p-2">Giriş</th>
              <th className="text-right p-2">Çıkış</th>
              <th className="text-right p-2">Fark</th>
            </tr>
          </thead>
          <tbody>
            {(report.partners || []).map((row) => (
              <tr key={row.id} className="border-t border-slate-100" data-testid={`recon-partner-${row.id}`}>
                <td className="p-2">{row.ad}</td>
                <td className="p-2 text-right">{money(row.kart_bakiyesi)}</td>
                <td className="p-2 text-right">{money(row.kayitli_bakiye)}</td>
                <td className="p-2 text-right">{money(row.liste_giris)}</td>
                <td className="p-2 text-right">{money(row.liste_cikis)}</td>
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
