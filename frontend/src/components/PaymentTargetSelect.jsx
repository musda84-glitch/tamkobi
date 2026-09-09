import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (n || 0).toLocaleString("tr-TR");
const COLLECT_TYPES = ["cash_box", "bank", "pos"];
const SPEND_TYPES = ["cash_box", "bank", "pos", "credit_card"];
const TYPE_LABEL = { bank: "Banka", cash_box: "Kasa", pos: "POS", credit_card: "Kredi Kartı (masraf)", other: "Diğer Hesaplar" };

/** Company credit cards are spend-only; tahsilat goes to kasa / bank / POS. */
export const collectableAccounts = (accounts) => (accounts || []).filter((a) => a.type !== "credit_card");
export const isCreditCard = (a) => a?.type === "credit_card";

export const splitPaymentTarget = (value) => {
  if (!value) return {};
  return value.startsWith("partner:") ? { partner_id: value.slice(8) } : { account_id: value };
};

export const paymentTargetValue = ({ account_id, partner_id } = {}) => (partner_id ? `partner:${partner_id}` : (account_id || ""));

const accountLabel = (a) => {
  const name = a.bank_name && a.account_name && a.bank_name !== a.account_name ? `${a.bank_name} - ${a.account_name}` : (a.account_name || a.bank_name || "Hesap");
  return `${name} (${fmt(a.current_balance)} ₺)`;
};

export const PaymentTargetSelect = ({ companyId, accounts, value, onChange, testId = "payment-target-select", className = "", emptyLabel, disabled = false, required = false, includePartners = true, collectableOnly = false }) => {
  const hideCards = collectableOnly || (Array.isArray(accounts) && accounts.length > 0 && !accounts.some((a) => a.type === "credit_card"));
  const apply = (list) => (hideCards ? collectableAccounts(list) : (list || []));
  const [liveAccounts, setLiveAccounts] = useState(apply(accounts));
  const [partners, setPartners] = useState([]);
  useEffect(() => { if (accounts?.length) setLiveAccounts(apply(accounts)); }, [accounts, hideCards]);
  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`).then((r) => { if (!cancelled) setLiveAccounts(apply(r.data || [])); }).catch(() => { if (!cancelled) setLiveAccounts(apply(accounts)); });
    if (includePartners) {
      axios.get(`${API_URL}/banking/partners?company_id=${companyId}`).then((r) => { if (!cancelled) setPartners((r.data || []).filter((p) => p.is_active !== false)); }).catch(() => { if (!cancelled) setPartners([]); });
    } else {
      setPartners([]);
    }
    return () => { cancelled = true; };
  }, [companyId, includePartners, hideCards]);
  const typeOrder = hideCards ? COLLECT_TYPES : SPEND_TYPES;
  const grouped = typeOrder.map((t) => [t, liveAccounts.filter((a) => a.type === t)]).filter(([, list]) => list.length);
  const other = liveAccounts.filter((a) => !typeOrder.includes(a.type));
  if (other.length) grouped.push(["other", other]);
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={`w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium ${className}`} data-testid={testId} disabled={disabled} required={required && !emptyLabel}>
      {emptyLabel !== undefined && emptyLabel !== false && <option value="">{emptyLabel}</option>}
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

export const PaymentTargetSelect = ({ companyId, accounts, value, onChange, testId = "payment-target-select", className = "", emptyLabel, disabled = false, required = false }) => {
  const [liveAccounts, setLiveAccounts] = useState(accounts || []);
  const [partners, setPartners] = useState([]);
  useEffect(() => { if (accounts?.length) setLiveAccounts(accounts); }, [accounts]);
  useEffect(() => {
    if (!companyId) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`).then((r) => { if (!cancelled) setLiveAccounts(r.data || []); }).catch(() => { if (!cancelled) setLiveAccounts(accounts || []); });
    axios.get(`${API_URL}/banking/partners?company_id=${companyId}`).then((r) => { if (!cancelled) setPartners((r.data || []).filter((p) => p.is_active !== false)); }).catch(() => { if (!cancelled) setPartners([]); });
    return () => { cancelled = true; };
  }, [companyId]);
  const grouped = TYPE_ORDER.map((t) => [t, liveAccounts.filter((a) => a.type === t)]).filter(([, list]) => list.length);
  const other = liveAccounts.filter((a) => !TYPE_ORDER.includes(a.type));
  if (other.length) grouped.push(["other", other]);
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={`w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium ${className}`} data-testid={testId} disabled={disabled} required={required && !emptyLabel}>
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {grouped.map(([t, list]) => (
        <optgroup key={t} label={TYPE_LABEL[t] || t}>
          {list.map((a) => <option key={a.id || a._id} value={a.id || a._id}>{accountLabel(a)}</option>)}
        </optgroup>
      ))}
export const PaymentTargetSelect = ({ companyId, accounts, value, onChange, testId = "payment-target-select", className = "", includePartners = true, emptyLabel }) => {
  const [partners, setPartners] = useState([]);
  useEffect(() => {
    if (!includePartners) { setPartners([]); return; }
    axios.get(`${API_URL}/banking/partners?company_id=${companyId}`).then((r) => setPartners(r.data.filter((p) => p.is_active !== false))).catch(() => setPartners([]));
  }, [companyId, includePartners]);
  const groups = ["cash_box", "bank", "pos"].map((t) => [t, (accounts || []).filter((a) => a.type === t)]).filter(([, l]) => l.length);
  const leftover = (accounts || []).filter((a) => !["cash_box", "bank", "pos"].includes(a.type));
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} className={`w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium ${className}`} data-testid={testId}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {groups.map(([t, list]) => (
        <optgroup key={t} label={TYPE_LABEL[t]}>
          {list.map((a) => <option key={a.id || a._id} value={a.id || a._id}>{a.bank_name} - {a.account_name} ({fmt(a.current_balance)} ₺)</option>)}
        </optgroup>
      ))}
      {leftover.length > 0 && (
        <optgroup label="Diğer">
          {leftover.map((a) => <option key={a.id || a._id} value={a.id || a._id}>{a.bank_name} - {a.account_name} ({fmt(a.current_balance)} ₺)</option>)}
        </optgroup>
      )}
      {includePartners && partners.length > 0 && (
        <optgroup label="Ortaklar Hesabı">
          {partners.map((p) => <option key={p.id} value={`partner:${p.id}`}>{p.name} (Ortak • %{p.share_percent} • {fmt(p.balance)} ₺)</option>)}
        </optgroup>
      )}
    </select>
  );
};
