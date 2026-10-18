import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Link2, MoreVertical, Pencil, Trash2, X } from "lucide-react";
import { fmtDate, formatTrAmount } from "../../utils/money";
import { accountDisplayLabel, accountMaskedRef, accountTypeLabel } from "../../utils/accountLabel";
import { openingEligible } from "../../utils/openingBalance";
import { canUploadBankStatement } from "../../utils/bankStatementUpload";

const money = (n) => formatTrAmount(n || 0);

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

function AccountRow({
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
  const masked = accountMaskedRef(acc);
  const hasSync = Object.prototype.hasOwnProperty.call(acc, "last_synced_at");
  const unmatched = Number(acc.unmatched_count);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(accId)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(accId); } }}
      className={`w-full text-left px-2.5 py-2 rounded-xl border transition ${selected ? "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-50/40" : "border-transparent hover:bg-slate-50"} ${menuOpen ? "relative z-20" : ""}`}
      data-testid={`bank-card-${accId}`}
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 w-8 h-8 rounded-lg bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center" aria-hidden>
          {accountMonogram(acc)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 truncate" title={accountDisplayLabel(acc)}>{accountDisplayLabel(acc)}</div>
              <div className="text-[10px] text-slate-500 truncate">
                {accountTypeLabel(acc.type)}
                {masked ? ` · ${masked}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              {openingEligible(acc) && (
                <div className="relative" data-testid={`account-card-menu-wrap-${accId}`}>
                  <button
                    type="button"
                    onClick={() => onToggleMenu(accId)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                    title="Hesap menüsü"
                    aria-label="Hesap menüsü"
                    data-testid={`account-card-menu-${accId}`}
                  >
                    <MoreVertical className="w-3.5 h-3.5" />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 top-8 z-30 min-w-[220px] bg-white border border-slate-200 rounded-xl shadow-lg py-1" data-testid={`account-card-menu-panel-${accId}`}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                        data-testid={`add-opening-balance-${accId}`}
                        onClick={() => onOpening(acc)}
                      >
                        Açılış/Devir bakiyesi ekle
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button type="button" onClick={(e) => onEdit(acc, e)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100" title="Düzelt" data-testid={`edit-account-${accId}`}><Pencil className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={(e) => onDelete(acc, e)} disabled={accountDeleteLocked(acc)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30" title={accountDeleteTitle(acc)} data-testid={`delete-account-${accId}`}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {acc.is_integrated && (
              <div
                className={`inline-flex items-center gap-1 text-[10px] font-bold rounded-md px-1.5 py-0.5 border ${
                  acc.integration_status === "connected"
                    ? "text-emerald-800 bg-emerald-50 border-emerald-200"
                    : acc.integration_status === "error"
                      ? "text-rose-800 bg-rose-50 border-rose-200"
                      : "text-blue-700 bg-blue-50 border-blue-200"
                }`}
                data-testid={`integrated-badge-${accId}`}
              >
                <span className="inline-flex items-center gap-0.5" data-testid={`group-integrated-${accId}`}>
                  <Link2 className="w-3 h-3" />
                  ENTEGRE · {acc.integration_provider || "Banka API"}
                  {acc.integration_status === "connected" ? " · CANLI" : acc.integration_status === "error" ? " · HATA" : acc.integration_status === "simulated" ? " · SİMÜLE" : ""}
                </span>
              </div>
            )}
            {unmatched > 0 && (
              <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5" data-testid={`account-unmatched-${accId}`}>
                {unmatched} eşleşmemiş
              </span>
            )}
          </div>
          {hasSync && (
            <div className="mt-0.5 text-[10px] text-slate-400" data-testid={`account-synced-${accId}`}>
              son senkron {relativeSyncLabel(acc.last_synced_at)}
            </div>
          )}
          {acc.bank_balance_drift && (
            <div className="mt-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 w-fit" data-testid={`balance-drift-${accId}`}>
              Banka bakiyesi defterden farklı
            </div>
          )}
          {isCard && (
            <div className={`mt-1 text-[10px] font-bold rounded-md px-2 py-0.5 w-fit border ${isCustomerCard ? "text-rose-800 bg-rose-50 border-rose-200" : "text-fuchsia-800 bg-fuchsia-50 border-fuchsia-200"}`} data-testid={`card-no-collect-${accId}`}>
              {isCustomerCard
                ? (acc.is_customer_card_pool
                  ? "Cari virman · müşteri kredi kartı ile işaretlenen hareketler"
                  : `Müşteri kartı · ${acc.linked_contact_name || "cari"}`)
                : "Şirket kartı · tahsilat kapalı · masraf / ekstre"}
            </div>
          )}
          {isCard && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-400">{acc.card_limit ? `Limit ${Number(acc.card_limit).toLocaleString("tr-TR")} ₺` : "Limit —"}{acc.last_statement?.due_date ? ` · Son ödeme ${fmtDate(acc.last_statement.due_date)}` : ""}</span>
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStatement(acc); }} className="text-[10px] font-semibold text-fuchsia-700 bg-fuchsia-50 hover:bg-fuchsia-100 px-2 py-0.5 rounded-md" data-testid={`card-stmt-btn-${accId}`}>Ekstre Aktar (AI)</button>
            </div>
          )}
          {canUploadBankStatement(acc) && (
            <div className="mt-1 flex items-center justify-end">
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStatement(acc); }}
                className="text-[10px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 px-2 py-0.5 rounded-md"
                title="PDF, Excel veya CSV hesap hareketi yükle"
                data-testid={`bank-stmt-btn-${accId}`}
              >
                Hareket Yükle (AI)
              </button>
            </div>
          )}
          <div className="mt-1 text-[11px] font-bold text-slate-900 tabular-nums" data-testid={acc.is_customer_card_pool ? `pool-balance-${accId}` : `account-balance-${accId}`}>
            {money(acc.is_customer_card_pool ? 0 : acc.current_balance)} ₺
          </div>
        </div>
      </div>
    </div>
  );
}

/** Soldaki açılır gruplu hesap listesi. */
export function BankAccountList({
  grouped = [],
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
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-2 space-y-1" data-testid="bank-account-list">
      {grouped.length === 0 && (
        <div className="px-3 py-6 text-center text-xs text-slate-400">Henüz hesap yok.</div>
      )}
      {grouped.map((g) => {
        const open = selectedGroup === g.type;
        return (
          <div key={g.type}>
            <button
              type="button"
              onClick={() => onToggleGroup(g.type)}
              className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl text-left hover:bg-slate-50 ${open ? "bg-slate-50" : ""}`}
              data-testid={`account-group-${g.type}`}
            >
              <span className="min-w-0">
                <span className="block text-xs font-bold text-slate-800">{g.short} · {g.items.length}</span>
                <span className="block text-[10px] text-slate-400 truncate">{g.items.map((a) => a.bank_name).filter(Boolean).slice(0, 3).join(" · ") || "—"}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{money(g.total)} ₺</span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
              </span>
            </button>
            {open && (
              <div className="pl-1 pr-0.5 pb-1 space-y-0.5" data-testid={`account-group-members-${g.type}`}>
                <div className="flex justify-end px-1">
                  <button
                    type="button"
                    onClick={() => onToggleGroup(g.type)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-full"
                    data-testid="clear-group-btn"
                  >
                    <X className="w-3 h-3 inline" /> Kapat
                  </button>
                </div>
                {g.items.map((acc) => {
                  const accId = acc.id || acc._id;
                  return (
                    <AccountRow
                      key={accId}
                      acc={acc}
                      selected={selectedAccountId === accId}
                      menuOpen={cardMenuId === accId}
                      onSelect={onSelectAccount}
                      onToggleMenu={onToggleMenu}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onOpening={onOpening}
                      onStatement={onStatement}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
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
