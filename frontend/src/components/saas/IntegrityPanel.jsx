import React, { useCallback, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const cred = { withCredentials: true };
const tl = (n) => Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Sistem paneli veya firma ayarları: orphan hareket / kasa kayması tarama + cleanup. */
export function IntegrityPanel({ companyId: fixedCompanyId, companies = [], compact = false }) {
  const [companyId, setCompanyId] = useState(fixedCompanyId || "");
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);

  const cid = fixedCompanyId || companyId;

  const load = useCallback(async () => {
    if (!cid) {
      toast.error("Şirket seçin.");
      return;
    }
    setBusy("scan");
    setPreview(null);
    try {
      const r = await axios.get(`${API_URL}/admin/integrity/orphans`, { ...cred, params: { company_id: cid } });
      setScan(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Tarama başarısız.");
      setScan(null);
    } finally {
      setBusy("");
    }
  }, [cid]);

  const runCleanup = async (dryRun) => {
    if (!cid) return;
    if (!dryRun && !window.confirm("Seçili orphan hareketler geri alınacak. Devam?")) return;
    setBusy(dryRun ? "preview" : "apply");
    try {
      const r = await axios.post(
        `${API_URL}/admin/integrity/cleanup`,
        { company_id: cid, dry_run: dryRun },
        cred,
      );
      setPreview(r.data);
      if (dryRun) toast.success("Önizleme hazır (değişiklik yok).");
      else {
        toast.success("Temizlik uygulandı.");
        await load();
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Cleanup başarısız.");
    } finally {
      setBusy("");
    }
  };

  const s = scan?.summary || {};

  return (
    <div className={`space-y-4 ${compact ? "" : "max-w-4xl"}`} data-testid="integrity-panel">
      <div className="flex flex-wrap items-end gap-3">
        {!fixedCompanyId && (
          <div className="min-w-[220px] flex-1">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Şirket</label>
            {companies.length ? (
              <select
                className={inputCls}
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                data-testid="integrity-company-select"
              >
                <option value="">Seçin…</option>
                {companies.map((c) => (
                  <option key={c.id || c._id} value={c.id || c._id}>
                    {c.name || c.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={inputCls}
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                placeholder="company_id"
                data-testid="integrity-company-input"
              />
            )}
          </div>
        )}
        <button
          type="button"
          onClick={load}
          disabled={!!busy || !cid}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 text-white text-sm font-semibold disabled:opacity-50"
          data-testid="integrity-scan-btn"
        >
          {busy === "scan" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Tara
        </button>
        <button
          type="button"
          onClick={() => runCleanup(true)}
          disabled={!!busy || !cid || !scan}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-sm font-semibold disabled:opacity-50"
          data-testid="integrity-preview-btn"
        >
          {busy === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          Önizle (dry-run)
        </button>
        <button
          type="button"
          onClick={() => runCleanup(false)}
          disabled={!!busy || !cid || !scan}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold disabled:opacity-50"
          data-testid="integrity-apply-btn"
        >
          {busy === "apply" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
          Temizle
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Prim/bordro/kredi kaynaklı orphan kasa-banka hareketleri, ödenmiş kayıtta eksik hareket ve kasa bakiyesi kaymasını listeler.
        Dry-run hiçbir şeyi değiştirmez.
      </p>

      {scan && (
        <div className="grid sm:grid-cols-4 gap-3" data-testid="integrity-summary">
          {[
            ["Orphan hareket", s.orphan_moves],
            ["Eksik bağ (ödenmiş)", s.paid_missing_moves],
            ["Kasa kayması", s.drift_accounts],
            ["Heuristik eşleşme", s.heuristic_links],
          ].map(([label, n]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</div>
              <div className="text-xl font-bold text-slate-800 tabular-nums">{n ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {scan?.cash_balance_drift?.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
            <AlertTriangle className="w-4 h-4" /> Kasa bakiyesi ≠ hareket toplamı
          </div>
          <ul className="text-xs space-y-1">
            {scan.cash_balance_drift.map((d) => (
              <li key={d.account_id} className="font-mono">
                {d.account_name || d.account_id}: kayıtlı {tl(d.stored)} → hareket {tl(d.from_movements)} (Δ {tl(d.drift)})
              </li>
            ))}
          </ul>
        </div>
      )}

      {scan && (
        <div className="space-y-3 text-xs">
          <OrphanList title="Orphan prim hareketleri" rows={scan.orphan_bonus_moves} />
          <OrphanList title="Orphan bordro hareketleri" rows={scan.orphan_payroll_moves} />
          <OrphanList title="Orphan kredi hareketleri" rows={scan.orphan_loan_moves} />
          <MissingList title="Ödenmiş prim / hareketsiz" rows={scan.paid_bonus_without_moves} />
          <MissingList title="Ödenmiş bordro / hareketsiz" rows={scan.paid_payroll_without_moves} />
        </div>
      )}

      {preview && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" data-testid="integrity-preview">
          <div className="font-semibold mb-1">
            Cleanup {preview.dry_run ? "(dry-run)" : "(uygulandı)"} · {preview.actions?.length || 0} işlem ·{" "}
            {preview.drift_fixes?.length || 0} kasa düzeltmesi
          </div>
          <pre className="overflow-auto max-h-48 text-[10px] whitespace-pre-wrap">{JSON.stringify(preview.actions?.slice(0, 20), null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function OrphanList({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="font-semibold text-slate-700 mb-1">{title} ({rows.length})</div>
      <ul className="space-y-1 max-h-40 overflow-auto">
        {rows.slice(0, 50).map((r) => (
          <li key={`${r.kind}-${r.tx_id}`} className="font-mono text-slate-600">
            {r.kind} · {r.tx_id?.slice?.(0, 8)} · {tl(r.amount)} · {(r.description || "").slice(0, 60)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MissingList({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="font-semibold text-slate-700 mb-1">{title} ({rows.length})</div>
      <ul className="space-y-1 max-h-40 overflow-auto">
        {rows.slice(0, 50).map((r) => (
          <li key={r.id} className="text-slate-600">
            {r.employee_name || r.id} · {tl(r.amount)}
            {r.heuristic_candidates?.length ? (
              <span className="text-amber-700"> · heuristik {r.heuristic_candidates[0].confidence}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default IntegrityPanel;
