import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (n || 0).toLocaleString("tr-TR");
const TYPE_LABEL = { bank: "Banka", cash_box: "Kasa", pos: "POS", credit_card: "Kredi Kartı" };
/** Tahsilatta kredi kartı yok (backend reddeder); ödemede kart + ortaklar açık. */
const COLLECT_TYPES = ["cash_box", "bank", "pos"];
const SPEND_TYPES = ["cash_box", "bank", "pos", "credit_card"];
/** Eski kayıtlarda cash / kasa gibi alias'lar da kasa grubuna düşsün. */
const TYPE_ALIAS = { cash: "cash_box", kasa: "cash_box", cashbox: "cash_box", nakit: "cash_box", cash_box: "cash_box" };
const normalizeType = (t) => TYPE_ALIAS[String(t || "").toLowerCase()] || t;

const bal = (a) => Number(a?.current_balance ?? a?.balance ?? 0);
const accId = (a) => a?.id || a?._id || "";
const accLabel = (a) => {
  const name = a.account_name || a.name || "Hesap";
  const bank = a.bank_name && a.bank_name !== name ? a.bank_name : "";
  return `${bank ? `${bank} — ` : ""}${name} (${fmt(bal(a))} ₺)`;
};

/** Company credit cards are spend-only; tahsilat goes to kasa / bank / POS. */
export const collectableAccounts = (accounts) => (accounts || []).filter((a) => normalizeType(a.type) !== "credit_card");
export const isCreditCard = (a) => normalizeType(a?.type) === "credit_card";

export const splitPaymentTarget = (value) => (value?.startsWith("partner:") ? { partner_id: value.slice(8) } : { account_id: value || null });

export const PaymentTargetSelect = ({
  companyId,
  accounts,
  value,
  onChange,
  testId = "payment-target-select",
  className = "",
  collectableOnly = false,
  includePartners = true,
  includeCreditCards = true,
  /** Virman: entegre hesapları listeden tamamen çıkar (seçilemez gösterme). */
  excludeIntegrated = false,
  emptyLabel,
  disabled = false,
}) => {
  const [partners, setPartners] = useState([]);
  // Parent listesi stale olabilir; companyId varken her mount'ta taze çek.
  const [liveAccounts, setLiveAccounts] = useState(() => accounts || []);
  useEffect(() => { setLiveAccounts(accounts || []); }, [accounts]);
  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`)
      .then((r) => { if (!cancelled) setLiveAccounts(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [companyId]);
  useEffect(() => {
    if (!includePartners) { setPartners([]); return undefined; }
    if (!companyId) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/banking/partners?company_id=${companyId}`)
      .then((r) => { if (!cancelled) setPartners((r.data || []).filter((p) => p.is_active !== false)); })
      .catch(() => { if (!cancelled) setPartners([]); });
    return () => { cancelled = true; };
  }, [companyId, includePartners]);

  const typeOrder = collectableOnly
    ? COLLECT_TYPES
    : (includeCreditCards ? SPEND_TYPES : COLLECT_TYPES);
  let pool = collectableOnly
    ? collectableAccounts(liveAccounts)
    : (includeCreditCards ? (liveAccounts || []) : collectableAccounts(liveAccounts));
  if (excludeIntegrated) pool = pool.filter((a) => !a.is_integrated);
  const groups = typeOrder.map((t) => [t, pool.filter((a) => normalizeType(a.type) === t)]).filter(([, l]) => l.length);
  const orphan = pool.filter((a) => !SPEND_TYPES.includes(normalizeType(a.type)));

  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium ${className}`} data-testid={testId}>
      {emptyLabel != null && <option value="">{emptyLabel}</option>}
      {groups.map(([t, list]) => (
        <optgroup key={t} label={TYPE_LABEL[t]}>
          {list.map((a) => <option key={accId(a)} value={accId(a)} disabled={!!a.is_integrated}>{accLabel(a)}{a.is_integrated ? " (entegre — seçilemez)" : ""}</option>)}
        </optgroup>
      ))}
      {orphan.length > 0 && (
        <optgroup label="Diğer Hesaplar">
          {orphan.map((a) => <option key={accId(a)} value={accId(a)} disabled={!!a.is_integrated}>{accLabel(a)}{a.is_integrated ? " (entegre — seçilemez)" : ""}</option>)}
        </optgroup>
      )}
      {includePartners && partners.length > 0 && (
        <optgroup label="Ortaklar Hesabı">
          {partners.map((p) => <option key={p.id} value={`partner:${p.id}`}>{p.name} (Ortak • %{p.share_percent ?? 0} · {fmt(p.balance)} ₺)</option>)}
        </optgroup>
      )}
    </select>
  );
};
