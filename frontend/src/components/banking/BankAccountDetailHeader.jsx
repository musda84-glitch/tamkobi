import React, { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { formatTrAmount } from "../../utils/money";
import { accountDisplayLabel, accountTypeLabel, isIban, maskedRef } from "../../utils/accountLabel";
import { AccountActionsMenu, accountMonogram, countOrDash, relativeSyncLabel } from "./BankAccountList";

export { countOrDash };

function hasField(account, key) {
  if (!account || !Object.prototype.hasOwnProperty.call(account, key)) return false;
  const value = account[key];
  return value != null && value !== "";
}

function moneyOrDash(account, key) {
  if (!hasField(account, key)) return "—";
  return `${formatTrAmount(account[key])} ₺`;
}

export function accountDetailSubtitle(account) {
  const parts = [];
  if (isIban(account?.iban)) parts.push(`IBAN ${maskedRef(account.iban)}`);
  parts.push(accountTypeLabel(account?.type) || "—");
  if (account?.is_integrated) {
    parts.push("ENTEGRE", account.integration_provider || "—", "CANLI");
  }
  parts.push(`son senkron ${relativeSyncLabel(account?.last_synced_at)}`);
  return parts.join(" · ");
}

function accountTitle(account) {
  const bank = String(account?.bank_name || "").trim();
  const name = String(account?.account_name || account?.name || "").trim();
  if (bank && name && name !== bank) return `${bank} · ${name}`;
  return name || bank || accountDisplayLabel(account);
}

function Kpi({ testId, label, value, onClick, active = false }) {
  const cls = `rounded-xl border px-3 py-2.5 text-left ${active ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`;
  const body = (
    <>
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-base font-bold tabular-nums text-slate-900" data-testid={`${testId}-value`}>{value}</div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${cls} hover:border-amber-300`} data-testid={testId}>
        {body}
      </button>
    );
  }
  return (
    <div className={cls} data-testid={testId}>
      {body}
    </div>
  );
}

/** Seçili hesap: breadcrumb, kimlik, senkron/virman/ekstre ve ay KPI'ları. */
export function BankAccountDetailHeader({
  account,
  groupLabel = "Hesap",
  groupType = null,
  canEdit = false,
  onGroupClick,
  onSynced,
  onVirman,
  onStatement,
  onEdit,
  onOpening,
  onDelete,
  onUnmatched,
  unmatchedActive = false,
}) {
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  if (!account) return null;
  const showSync = !!(account.is_integrated && account.connection_id && canEdit);
  const balance = account.is_customer_card_pool
    ? `${formatTrAmount(0)} ₺`
    : moneyOrDash(account, "current_balance");

  const sync = async () => {
    const id = account.connection_id;
    if (!showSync || !id || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const r = await axios.post(`${API_URL}/banking/connections/${id}/sync`);
      toast.success(r.data?.message || "Senkronize edildi.");
      if (onSynced) await onSynced();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Senkronizasyon başarısız.");
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="bank-account-detail-header">
      <div className="text-[11px] text-slate-500" data-testid="account-detail-crumb">
        <span>Banka, Kasa & POS</span>
        <span> › </span>
        <button
          type="button"
          onClick={() => onGroupClick?.(groupType)}
          className="font-semibold text-slate-700 hover:text-slate-950"
          data-testid="account-detail-crumb-group"
        >
          {groupLabel}
        </button>
        <span> › </span>
        <span className="font-semibold text-slate-900">{accountDisplayLabel(account)}</span>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 w-10 h-10 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center justify-center" aria-hidden data-testid="account-detail-monogram">
            {accountMonogram(account)}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 truncate" data-testid="account-detail-title">{accountTitle(account)}</h2>
            <p className="text-[11px] text-slate-500 leading-snug" data-testid="account-detail-subtitle">{accountDetailSubtitle(account)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showSync && (
            <button
              type="button"
              onClick={sync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60"
              data-testid="account-sync-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Senkronize ediliyor…" : "Senkronize et"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onVirman?.()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
            data-testid="account-detail-virman"
          >
            Virman
          </button>
          <button
            type="button"
            onClick={() => onStatement?.()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50"
            data-testid="account-detail-statement"
          >
            Ekstre
          </button>
          <AccountActionsMenu account={account} onEdit={onEdit} onDelete={onDelete} onOpening={onOpening} />
        </div>
      </div>
      {account.is_integrated && (
        <div className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="integrated-manual-note">
          Manuel Tahsilat/Tediye kapalı.
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-testid="account-detail-kpis">
        <Kpi testId="account-kpi-balance" label="Bakiye" value={balance} />
        <Kpi testId="account-kpi-month-in" label="Bu ay giriş" value={moneyOrDash(account, "month_in")} />
        <Kpi testId="account-kpi-month-out" label="Bu ay çıkış" value={moneyOrDash(account, "month_out")} />
        <Kpi
          testId="account-kpi-unmatched"
          label="Eşleşmemiş"
          value={countOrDash(account, "unmatched_count")}
          onClick={() => onUnmatched?.()}
          active={unmatchedActive}
        />
      </div>
    </div>
  );
}
