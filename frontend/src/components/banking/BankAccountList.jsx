import React, { useEffect, useRef, useState } from "react";
import { CreditCard, History, Link2, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { fmtDate, formatTrAmount } from "../../utils/money";
import { accountDisplayLabel, accountMaskedRef, accountTypeLabel } from "../../utils/accountLabel";
import { openingEligible } from "../../utils/openingBalance";
import { canUploadBankStatement } from "../../utils/bankStatementUpload";

const money = (n) => formatTrAmount(n || 0);

const PRIMARY_TAB_TYPES = ["bank", "cash_box", "pos", "customer_credit_card"];

export function relativeSyncLabel(iso, now = new Date()) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now.getTime() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} gün önce`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} ay önce`;
  return `${Math.floor(mo / 12)} yıl önce`;
}

export function accountMonogram(acc) {
  const src = String(acc?.bank_name || acc?.account_name || "•").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  const raw = parts.length >= 2 ? `${parts[0][0] || ""}${parts[1][0] || ""}` : src.slice(0, 2);
  return raw.toLocaleUpperCase("tr-TR") || "•";
}

export function accountDeleteLocked(acc) {
  return !!acc?.is_integrated;
}

export function accountDeleteTitle(acc) {
  return accountDeleteLocked(acc) ? "Entegre hesap silinemez" : "Sil";
}

export function countOrDash(account, key) {
  if (!account || !Object.prototype.hasOwnProperty.call(account, key)) return "—";
  const value = account[key];
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

function EditAccountButton({ acc, onEdit, className, children }) {
  const accId = acc.id || acc._id;
  return (
    <button type="button" onClick={(e) => onEdit(acc, e)} className={className} title="Düzelt" data-testid={`edit-account-${accId}`}>
      {children}
    </button>
  );
}

function DeleteAccountButton({ acc, onDelete, className, children }) {
  const accId = acc.id || acc._id;
  const locked = accountDeleteLocked(acc);
  return (
    <button
      type="button"
      onClick={(e) => { if (locked) return; onDelete(acc, e); }}
      disabled={locked}
      className={className}
      title={accountDeleteTitle(acc)}
      data-testid={`delete-account-${accId}`}
    >
      {children}
    </button>
  );
}

function CardStatementButton({ acc, onStatement, className }) {
  const accId = acc.id || acc._id;
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStatement(acc); }}
      className={className}
      data-testid={`card-stmt-btn-${accId}`}
    >
      Ekstre Aktar (AI)
    </button>
  );
}

function tabCls(active) {
  return `px-2.5 py-1 rounded-full text-[11px] font-semibold border whitespace-nowrap ${
    active
      ? "bg-slate-900 text-white border-slate-900"
      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
  }`;
}

function AccountChip({
  acc,
  selected,
  menuOpen,
  onSelect,
  onToggleMenu,
  onEdit,
  onDelete,
  onOpening,
  onStatement,
}) {
  const accId = acc.id || acc._id;
  const isCard = acc.type === "credit_card";
  const isCustomerCard = isCard && acc.card_owner === "customer";
  const hasSync = Object.prototype.hasOwnProperty.call(acc, "last_synced_at");
  const unmatchedLabel = countOrDash(acc, "unmatched_count");
  const showUnmatched = unmatchedLabel > 0;
  const showMenu = openingEligible(acc);
  const label = accountDisplayLabel(acc);
  const masked = accountMaskedRef(acc);
  const integratedTitle = acc.is_integrated
    ? `ENTEGRE · ${acc.integration_provider || "Banka API"}${
      acc.integration_status === "connected"
        ? " · CANLI"
        : acc.integration_status === "error"
          ? " · HATA"
          : acc.integration_status === "simulated"
            ? " · SİMÜLE"
            : ""
    }`
    : "";
  const cardTitle = isCustomerCard
    ? (acc.is_customer_card_pool
      ? "Cari virman · müşteri kredi kartı ile işaretlenen hareketler"
      : `Müşteri kartı · ${acc.linked_contact_name || "cari"}`)
    : "Şirket kartı · tahsilat kapalı · masraf / ekstre";
  const syncTitle = `son senkron ${relativeSyncLabel(acc.last_synced_at)}`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(accId)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(accId);
        }
      }}
      className={`inline-flex items-center gap-1.5 max-w-full rounded-full border px-2.5 py-1 text-left transition ${selected ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-50/60" : "border-slate-200 bg-white hover:bg-slate-50"} ${menuOpen ? "relative z-20" : "relative"}`}
      data-testid={`bank-card-${accId}`}
      title={masked ? `${label} · ${accountTypeLabel(acc.type)} · ${masked}` : label}
    >
      <span className="text-xs font-bold text-slate-900 line-clamp-2 break-words max-w-[14rem]" title={label}>{label}</span>
      <span
        className="text-[11px] font-bold text-slate-900 tabular-nums whitespace-nowrap"
        data-testid={acc.is_customer_card_pool ? `pool-balance-${accId}` : `account-balance-${accId}`}
      >
        {money(acc.is_customer_card_pool ? 0 : acc.current_balance)} ₺
      </span>
      {showUnmatched && (
        <span className="text-[10px] font-semibold text-orange-800 bg-orange-50 border border-orange-200 rounded-full px-1.5 py-0.5 whitespace-nowrap" data-testid={`account-unmatched-${accId}`}>
          {unmatchedLabel} eşleşmemiş
        </span>
      )}
      {acc.is_integrated && (
        <span className="inline-flex shrink-0 text-blue-700" title={integratedTitle} data-testid={`integrated-badge-${accId}`}>
          <span className="inline-flex items-center" data-testid={`group-integrated-${accId}`}>
            <Link2 className="w-3 h-3" />
            <span className="sr-only">{integratedTitle}</span>
          </span>
        </span>
      )}
      {hasSync && (
        <span className="inline-flex shrink-0 text-slate-400" title={syncTitle} data-testid={`account-synced-${accId}`}>
          <History className="w-3 h-3" />
          <span className="sr-only">{syncTitle}</span>
        </span>
      )}
      {acc.bank_balance_drift && (
        <span className="inline-flex shrink-0 items-center" title="Banka bakiyesi defterden farklı" data-testid={`balance-drift-${accId}`}>
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="sr-only">Banka bakiyesi defterden farklı</span>
        </span>
      )}
      {isCard && (
        <span
          className={`inline-flex shrink-0 ${isCustomerCard ? "text-rose-700" : "text-fuchsia-700"}`}
          title={cardTitle}
          data-testid={`card-no-collect-${accId}`}
        >
          <CreditCard className="w-3 h-3" />
          <span className="sr-only">{cardTitle}</span>
        </span>
      )}
      {isCard && acc.card_limit ? (
        <span className="sr-only">{`Limit ${Number(acc.card_limit).toLocaleString("tr-TR")} ₺`}{acc.last_statement?.due_date ? ` · Son ödeme ${fmtDate(acc.last_statement.due_date)}` : ""}</span>
      ) : null}
      {showMenu ? (
        <span className="inline-flex shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <div className="relative" data-testid={`account-card-menu-wrap-${accId}`}>
            <button
              type="button"
              onClick={() => onToggleMenu(accId)}
              className="p-1 rounded-full text-slate-400 hover:text-slate-900 hover:bg-slate-100"
              title="Hesap menüsü"
              aria-label="Hesap menüsü"
              aria-expanded={menuOpen}
              data-testid={`account-card-menu-${accId}`}
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-30 min-w-[220px] bg-white border border-slate-200 rounded-xl shadow-lg py-1" data-testid={`account-card-menu-panel-${accId}`}>
                <EditAccountButton acc={acc} onEdit={onEdit} className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                  Düzenle
                </EditAccountButton>
                <DeleteAccountButton acc={acc} onDelete={onDelete} className="w-full text-left px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-30 disabled:hover:bg-transparent">
                  Sil
                </DeleteAccountButton>
                {openingEligible(acc) && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    data-testid={`add-opening-balance-${accId}`}
                    onClick={() => onOpening(acc)}
                  >
                    Açılış/Devir bakiyesi ekle
                  </button>
                )}
                {canUploadBankStatement(acc) && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStatement(acc); }}
                    className="w-full text-left px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50"
                    title="PDF, Excel veya CSV hesap hareketi yükle"
                    data-testid={`bank-stmt-btn-${accId}`}
                  >
                    Hareket Yükle (AI)
                  </button>
                )}
                {isCard && (
                  <CardStatementButton acc={acc} onStatement={onStatement} className="w-full text-left px-3 py-2 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-50" />
                )}
              </div>
            )}
          </div>
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {isCard && (
            <CardStatementButton acc={acc} onStatement={onStatement} className="text-[10px] font-semibold text-fuchsia-700 bg-fuchsia-50 hover:bg-fuchsia-100 px-2 py-0.5 rounded-md" />
          )}
          <EditAccountButton acc={acc} onEdit={onEdit} className="p-1 rounded-full text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <Pencil className="w-3.5 h-3.5" />
          </EditAccountButton>
          <DeleteAccountButton acc={acc} onDelete={onDelete} className="p-1 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30">
            <Trash2 className="w-3.5 h-3.5" />
          </DeleteAccountButton>
        </span>
      )}
    </div>
  );
}

/** Grup sekmeleri ve seçili grubun hesap çipleri. Tümü seçilince selectedGroup null olur. */
export function BankAccountList({
  grouped = [],
  groupedAll = null,
  selectedGroup = null,
  selectedAccountId = null,
  cardMenuId = null,
  onToggleGroup,
  onSelectAccount,
  onToggleMenu,
  onEdit,
  onDelete,
  onOpening,
  onStatement,
}) {
  const source = Array.isArray(groupedAll) && groupedAll.length ? groupedAll : grouped;
  const byType = new Map(source.map((g) => [g.type, g]));
  const extras = source.filter((g) => !PRIMARY_TAB_TYPES.includes(g.type) && g.items.length > 0);
  const tabs = [
    ...PRIMARY_TAB_TYPES.map((type) => byType.get(type)).filter(Boolean),
    ...extras,
  ];
  const rows = selectedGroup
    ? tabs.filter((g) => g.type === selectedGroup)
    : tabs.filter((g) => g.items.length > 0);
  const chipProps = {
    onSelect: onSelectAccount,
    onToggleMenu,
    onEdit,
    onDelete,
    onOpening,
    onStatement,
  };

  return (
    <div className="space-y-2" data-testid="bank-account-list">
      <div className="flex flex-wrap items-center gap-1.5" data-testid="account-group-tabs">
        <button
          type="button"
          onClick={() => onToggleGroup(null)}
          className={tabCls(!selectedGroup)}
          data-testid="clear-group-btn"
        >
          Tümü
        </button>
        {tabs.map((g) => (
          <button
            key={g.type}
            type="button"
            onClick={() => onToggleGroup(g.type)}
            className={tabCls(selectedGroup === g.type)}
            data-testid={`account-group-${g.type}`}
          >
            {g.short} · {g.items.length} · <span className="tabular-nums">{money(g.total)} ₺</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" data-testid="account-chip-row">
        {rows.map((g) => (
          <div key={g.type} className="contents" data-testid={`account-group-members-${g.type}`}>
            {g.items.map((acc) => {
              const accId = acc.id || acc._id;
              return (
                <AccountChip
                  key={accId}
                  acc={acc}
                  selected={selectedAccountId === accId}
                  menuOpen={cardMenuId === accId}
                  {...chipProps}
                />
              );
            })}
          </div>
        ))}
      </div>
      {source.every((g) => g.items.length === 0) && (
        <div className="px-1 text-xs text-slate-400">Henüz hesap yok.</div>
      )}
    </div>
  );
}

/** Hesap detayındaki ⋯ menüsü. Liste satırındaki düzenle / açılış / sil handler'ları. */
export function AccountActionsMenu({ account, onEdit, onDelete, onOpening }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const accId = account?.id || account?._id;
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (wrapRef.current && wrapRef.current.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!account) return null;
  const locked = accountDeleteLocked(account);
  return (
    <div className="relative" ref={wrapRef} data-testid={`account-detail-menu-wrap-${accId}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50"
        title="Hesap menüsü"
        aria-label="Hesap menüsü"
        aria-expanded={open}
        data-testid="account-detail-menu"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      <div
        hidden={!open}
        className="absolute right-0 top-10 z-30 min-w-[220px] bg-white border border-slate-200 rounded-xl shadow-lg py-1"
        data-testid="account-detail-menu-panel"
      >
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          data-testid="account-detail-edit"
          onClick={(e) => { setOpen(false); onEdit?.(account, e); }}
        >
          Düzenle
        </button>
        {openingEligible(account) && (
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            data-testid="account-detail-opening"
            onClick={() => { setOpen(false); onOpening?.(account); }}
          >
            Açılış/Devir bakiyesi ekle
          </button>
        )}
        <button
          type="button"
          disabled={locked}
          title={accountDeleteTitle(account)}
          className="w-full text-left px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-30 disabled:hover:bg-transparent"
          data-testid="account-detail-delete"
          onClick={(e) => { if (locked) return; setOpen(false); onDelete?.(account, e); }}
        >
          Sil
        </button>
      </div>
    </div>
  );
}
