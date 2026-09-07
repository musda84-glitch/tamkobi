import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (n || 0).toLocaleString("tr-TR");
const TYPE_ORDER = ["cash_box", "bank", "pos", "credit_card"];
const TYPE_LABEL = { bank: "Banka", cash_box: "Kasa", pos: "POS", credit_card: "Kredi Kartı", other: "Diğer Hesaplar" };

export const splitPaymentTarget = (value) => {
  if (!value) return {};
  return value.startsWith("partner:") ? { partner_id: value.slice(8) } : { account_id: value };
};

export const paymentTargetValue = ({ account_id, partner_id } = {}) => (partner_id ? `partner:${partner_id}` : (account_id || ""));

const accountLabel = (a) => {
  const name = a.bank_name && a.account_name && a.bank_name !== a.account_name ? `${a.bank_name} - ${a.account_name}` : (a.account_name || a.bank_name || "Hesap");
  return `${name} (${fmt(a.current_balance)} ₺)`;
};

export const PaymentTargetSelect = ({ companyId, accounts, value, onChange, testId = "payment-target-select", className = "", emptyLabel, disabled = false, required = false, includePartners = true }) => {
  const [liveAccounts, setLiveAccounts] = useState(accounts || []);
  const [partners, setPartners] = useState([]);
  useEffect(() => { if (accounts?.length) setLiveAccounts(accounts); }, [accounts]);
  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`).then((r) => { if (!cancelled) setLiveAccounts(r.data || []); }).catch(() => { if (!cancelled) setLiveAccounts(accounts || []); });
    if (includePartners) {
      axios.get(`${API_URL}/banking/partners?company_id=${companyId}`).then((r) => { if (!cancelled) setPartners((r.data || []).filter((p) => p.is_active !== false)); }).catch(() => { if (!cancelled) setPartners([]); });
    } else {
      setPartners([]);
    }
    return () => { cancelled = true; };
  }, [companyId, includePartners]);
  const grouped = TYPE_ORDER.map((t) => [t, liveAccounts.filter((a) => a.type === t)]).filter(([, list]) => list.length);
  const other = liveAccounts.filter((a) => !TYPE_ORDER.includes(a.type));
  if (other.length) grouped.push(["other", other]);
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={`w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium ${className}`} data-testid={testId} disabled={disabled} required={required && !emptyLabel}>
      {emptyLabel !== undefined && emptyLabel !== false && <option value="">{emptyLabel}</option>}
      {grouped.map(([t, list]) => (
        <optgroup key={t} label={TYPE_LABEL[t] || t}>
          {list.map((a) => <option key={a.id || a._id} value={a.id || a._id}>{accountLabel(a)}</option>)}
        </optgroup>
      ))}
      {includePartners && partners.length > 0 && (
        <optgroup label="Ortaklar Hesabı">
          {partners.map((p) => <option key={p.id} value={`partner:${p.id}`}>{p.name} (Ortak • %{p.share_percent} • {fmt(p.balance)} ₺)</option>)}
        </optgroup>
      )}
    </select>
  );
};
