import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";
import { formatTrAmount } from "../utils/money";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { accountDisplayLabel, accountTypeLabel } from "../utils/accountLabel";
import { BulkResultModal } from "./BulkResultModal";

const REPAIR_TYPES = new Set(["bank", "pos", "okc_pos", "cash_box"]);

function canRepairAccount(row) {
  return REPAIR_TYPES.has(String(row?.tur || "")) && Math.abs(Number(row?.fark) || 0) >= 0.01;
}

const money = (n) => formatTrAmount(n || 0);

function Drift({ value }) {
  const n = Number(value) || 0;
  const off = Math.abs(n) >= 0.01;
  return <span className={off ? "text-rose-700 font-bold" : "text-emerald-700"}>{money(n)}</span>;
}

function canSaveOpening(row) {
  return Math.abs(Number(row?.fark) || 0) >= 0.01 && !row?.acilis_var;
}

function accountRowLabel(row) {
  return accountDisplayLabel(row);
}

export function ReconciliationPanel({ companyId, canRepairBalances = false }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openingRow, setOpeningRow] = useState(null);
  const [savingOpening, setSavingOpening] = useState(false);
  const [repairPreview, setRepairPreview] = useState(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairResult, setRepairResult] = useState(null);

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

  const openRepair = async (ids) => {
    if (!canRepairBalances || repairBusy || !ids?.length) return;
    setRepairBusy(true);
    try {
      const r = await axios.post(`${API_URL}/banking/accounts/recalculate-balances`, {
        company_id: companyId,
        dry_run: true,
        account_ids: ids,
      });
      const accounts = r.data?.accounts || [];
      if (!accounts.length) {
        toast.error("Düzeltilecek fark yok.");
        return;
      }
      setOpeningRow(null);
      setRepairPreview(r.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Bakiye önizlemesi alınamadı.");
    } finally {
      setRepairBusy(false);
    }
  };

  const confirmRepair = async () => {
    const accounts = repairPreview?.accounts || [];
    if (!accounts.length || repairBusy) return;
    setRepairBusy(true);
    const expectedStored = {};
    accounts.forEach((row) => { expectedStored[row.id] = row.stored; });
    try {
      const r = await axios.post(`${API_URL}/banking/accounts/recalculate-balances`, {
        company_id: companyId,
        dry_run: false,
        account_ids: accounts.map((row) => row.id),
        expected_stored: expectedStored,
      });
      setRepairPreview(null);
      setRepairResult(r.data?.results || []);
      await load();
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Bakiye düzeltilemedi.");
    } finally {
      setRepairBusy(false);
    }
  };

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
  const repairable = (report?.accounts || []).filter(canRepairAccount);
  const hasAccountDrift = (report?.accounts || []).some((row) => Math.abs(Number(row?.fark) || 0) >= 0.01);
  const previewAccounts = repairPreview?.accounts || [];
  const showReported = previewAccounts.some((row) => row.bank_reported_balance != null);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-700" data-testid="reconciliation-summary">
          Hesap farkı {summary.account_drift || 0}/{summary.account_count || 0}
          {" · "}Ortak farkı {summary.partner_drift || 0}/{summary.partner_count || 0}
          {" · "}Cari farkı {summary.contact_drift || 0}/{summary.contact_count || 0}
        </div>
        {canRepairBalances && repairable.length > 0 && (
          <button
            type="button"
            className="text-[11px] font-semibold bg-indigo-600 text-white px-2.5 py-1.5 rounded-lg disabled:opacity-50"
            data-testid="recon-repair-all"
            disabled={repairBusy}
            onClick={() => openRepair(repairable.map((row) => row.id))}
          >
            Tüm farklı hesapları düzelt
          </button>
        )}
      </div>
      {hasAccountDrift && (
        <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2" data-testid="recon-drift-note">
          Fark, kayıtlı bakiyenin hareket toplamından sapmasıdır. Açılış bakiyesi yeni bir hareket yazar ve gösterilen bakiyeyi değiştirmez; kayıtlı bakiye kopmuşsa bu buton önerilmez. Bakiyeyi hareketlerden düzeltmek kayıtlı tutarı hareket toplamına eşitler, hareketler değişmez.
        </p>
      )}
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
                <td className="p-2">{accountRowLabel(row)}</td>
                <td className="p-2">{accountTypeLabel(row.tur)}</td>
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
                  <div className="flex flex-col items-end gap-1">
                    {canRepairBalances && canRepairAccount(row) && (
                      <button
                        type="button"
                        className="text-[10px] font-semibold text-indigo-700 hover:underline disabled:opacity-50"
                        data-testid={`recon-repair-balance-${row.id}`}
                        disabled={repairBusy}
                        onClick={() => openRepair([row.id])}
                      >
                        Bakiyeyi hareketlerden düzelt
                      </button>
                    )}
                    {canSaveOpening(row) && (
                      <button
                        type="button"
                        className={`text-[10px] font-semibold hover:underline ${canRepairBalances && canRepairAccount(row) ? "text-slate-500" : "text-indigo-700"}`}
                        data-testid={`recon-save-opening-${row.id}`}
                        onClick={() => setOpeningRow(row)}
                      >
                        Farkı açılış bakiyesi olarak kaydet
                      </button>
                    )}
                  </div>
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
              {accountRowLabel(openingRow)}: {money(openingRow.fark)} tutarındaki fark, ilk hareketten bir gün öncesine açılış hareketi olarak yazılacak.
              Gösterilen bakiye değişmez. Kayıtlı bakiye hareket toplamından kopmuşsa bu kayıt önerilmez; bakiye hareketlerden düzeltilir, hareketler değişmez.
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
      {repairPreview && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" data-testid="recon-repair-modal" {...backdropDismissProps(() => { if (!repairBusy) setRepairPreview(null); })}>
          <div className="bg-white rounded-2xl max-w-3xl w-full p-5 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900">Bakiyeyi hareketlerden düzelt</h3>
            <p className="text-xs text-slate-700 font-medium" data-testid="recon-repair-warning">
              Kayıtlı bakiye hareket toplamına eşitlenir; hareketler değişmez.
            </p>
            <p className="text-[11px] text-slate-500">Etkilenen hesap: {repairPreview.affected_count ?? previewAccounts.length}. Açılış hareketi yazılmaz.</p>
            {showReported && (
              <p className="text-[11px] text-slate-500">Banka bağlantılı hesapta onarım yine hareket toplamınadır. Bankanın bildirdiği tutar bilgi içindir.</p>
            )}
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs" data-testid="recon-repair-table">
                <thead className="text-slate-500 uppercase text-[10px]">
                  <tr>
                    <th className="text-left p-2">Hesap</th>
                    <th className="text-left p-2">Tür</th>
                    <th className="text-right p-2">Kayıtlı</th>
                    <th className="text-right p-2">Hareket</th>
                    <th className="text-right p-2">Fark</th>
                    <th className="text-right p-2">Hareket sayısı</th>
                    {showReported && <th className="text-right p-2">Banka bildirdiği</th>}
                  </tr>
                </thead>
                <tbody>
                  {previewAccounts.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100" data-testid={`recon-repair-row-${row.id}`}>
                      <td className="p-2">{row.name}</td>
                      <td className="p-2">{accountTypeLabel(row.type)}</td>
                      <td className="p-2 text-right">{money(row.stored)}</td>
                      <td className="p-2 text-right">{money(row.ledger)}</td>
                      <td className="p-2 text-right"><Drift value={row.diff} /></td>
                      <td className="p-2 text-right">{row.movement_count ?? 0}</td>
                      {showReported && (
                        <td className="p-2 text-right">{row.bank_reported_balance == null ? "—" : money(row.bank_reported_balance)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-1.5 text-xs border rounded-lg" data-testid="recon-repair-cancel" disabled={repairBusy} onClick={() => setRepairPreview(null)}>Vazgeç</button>
              <button type="button" className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg disabled:opacity-50" data-testid="recon-repair-confirm" disabled={repairBusy} onClick={confirmRepair}>
                {repairBusy ? "Düzeltiliyor…" : "Bakiyeyi düzelt"}
              </button>
            </div>
          </div>
        </div>
      )}
      {repairResult && (
        <BulkResultModal
          title="Bakiye düzeltme sonucu"
          items={repairResult}
          onClose={() => setRepairResult(null)}
        />
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
