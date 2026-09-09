import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

const fmt = (n) => (n || 0).toLocaleString("tr-TR");
const TYPE_LABEL = { bank: "Banka", cash_box: "Kasa", pos: "POS" };

export const splitPaymentTarget = (value) => (value?.startsWith("partner:") ? { partner_id: value.slice(8) } : { account_id: value });

export const PaymentTargetSelect = ({ companyId, accounts, value, onChange, testId = "payment-target-select", className = "" }) => {
  const [partners, setPartners] = useState([]);
  useEffect(() => { axios.get(`${API_URL}/banking/partners?company_id=${companyId}`).then((r) => setPartners(r.data.filter((p) => p.is_active !== false))).catch(() => setPartners([])); }, [companyId]);
  const groups = ["cash_box", "bank", "pos"].map((t) => [t, (accounts || []).filter((a) => a.type === t)]).filter(([, l]) => l.length);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium ${className}`} data-testid={testId}>
      {groups.map(([t, list]) => (
        <optgroup key={t} label={TYPE_LABEL[t]}>
          {list.map((a) => <option key={a.id || a._id} value={a.id || a._id}>{a.bank_name} - {a.account_name} ({fmt(a.current_balance)} ₺)</option>)}
        </optgroup>
      ))}
      {partners.length > 0 && (
        <optgroup label="Ortaklar Hesabı">
          {partners.map((p) => <option key={p.id} value={`partner:${p.id}`}>{p.name} (Ortak • %{p.share_percent})</option>)}
        </optgroup>
      )}
    </select>
  );
};
