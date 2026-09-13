import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (n || 0).toLocaleString("tr-TR");
const TYPE_LABEL = { bank: "Banka", cash_box: "Kasa", pos: "POS", credit_card: "Kredi Kartı (masraf)" };
const COLLECT_TYPES = ["cash_box", "bank", "pos"];
const SPEND_TYPES = ["cash_box", "bank", "pos", "credit_card"];
/** Eski kayıtlarda cash / kasa gibi alias'lar da kasa grubuna düşsün. */
const TYPE_ALIAS = { cash: "cash_box", kasa: "cash_box", cashbox: "cash_box", nakit: "cash_box" };
const normalizeType = (t) => TYPE_ALIAS[String(t || "").toLowerCase()] || t;

/** Company credit cards are spend-only; tahsilat goes to kasa / bank / POS. */
export const collectableAccounts = (accounts) => (accounts || []).filter((a) => normalizeType(a.type) !== "credit_card");
export const isCreditCard = (a) => normalizeType(a?.type) === "credit_card";

export const splitPaymentTarget = (value) => (value?.startsWith("partner:") ? { partner_id: value.slice(8) } : { account_id: value });

export const PaymentTargetSelect = ({
  companyId,
  accounts,
  value,
  onChange,
  testId = "payment-target-select",
  className = "",
  collectableOnly = false,
  includePartners = true,
  emptyLabel,
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
    if (!includePartners) { setPartners([]); return; }
    if (!companyId) return;
    axios.get(`${API_URL}/banking/partners?company_id=${companyId}`).then((r) => setPartners(r.data.filter((p) => p.is_active !== false))).catch(() => setPartners([]));
  }, [companyId, includePartners]);
  const pool = collectableOnly ? collectableAccounts(liveAccounts) : (liveAccounts || []);
  const groups = (collectableOnly ? COLLECT_TYPES : SPEND_TYPES).map((t) => [t, pool.filter((a) => normalizeType(a.type) === t)]).filter(([, l]) => l.length);
  const orphan = pool.filter((a) => !SPEND_TYPES.includes(normalizeType(a.type)));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium ${className}`} data-testid={testId}>
      {emptyLabel != null && <option value="">{emptyLabel}</option>}
      {groups.map(([t, list]) => (
        <optgroup key={t} label={TYPE_LABEL[t]}>
          {list.map((a) => <option key={a.id || a._id} value={a.id || a._id}>{a.bank_name} - {a.account_name} ({fmt(a.current_balance)} ₺)</option>)}
        </optgroup>
      ))}
      {orphan.length > 0 && (
        <optgroup label="Diğer Hesaplar">
          {orphan.map((a) => <option key={a.id || a._id} value={a.id || a._id}>{a.bank_name || a.type} - {a.account_name} ({fmt(a.current_balance)} ₺)</option>)}
        </optgroup>
      )}
      {partners.length > 0 && (
        <optgroup label="Ortaklar Hesabı">
          {partners.map((p) => <option key={p.id} value={`partner:${p.id}`}>{p.name} (Ortak • %{p.share_percent})</option>)}
        </optgroup>
      )}
    </select>
  );
};
