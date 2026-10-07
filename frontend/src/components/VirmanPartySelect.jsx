import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import { SearchSelect } from "./SearchSelect";

const CONTACT_TYPE_LABEL = { customer: "Müşteri", supplier: "Tedarikçi", both: "Cari" };
const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR");

const contactIdFromValue = (value) => (
  String(value || "").startsWith("contact:") ? String(value).slice(8) : ""
);
const isContactValue = (value) => String(value || "").startsWith("contact:");

/**
 * Virman uç seçimi: hesap/ortak (select) veya cari (aranabilir) — ayrı modlar.
 * value: accountId | partner:id | contact:id
 */
export const VirmanPartySelect = ({
  companyId,
  accounts,
  value,
  onChange,
  testId = "virman-party",
  label = "Hesap",
  contacts: contactsProp,
  includePartners = true,
  excludeIntegrated = true,
  disabled = false,
  emptyLabel,
  className = "",
}) => {
  const [mode, setMode] = useState(() => (isContactValue(value) ? "contact" : "account"));
  const [contacts, setContacts] = useState(() => (Array.isArray(contactsProp) ? contactsProp : []));

  useEffect(() => {
    setMode(isContactValue(value) ? "contact" : "account");
  }, [value]);

  useEffect(() => {
    if (Array.isArray(contactsProp)) setContacts(contactsProp);
  }, [contactsProp]);

  const reloadContacts = useCallback(() => {
    if (!companyId || Array.isArray(contactsProp)) return;
    axios.get(`${API_URL}/contacts?company_id=${companyId}&lite=1`)
      .then((r) => setContacts(Array.isArray(r.data) ? r.data : []))
      .catch(() => setContacts([]));
  }, [companyId, contactsProp]);

  useEffect(() => { reloadContacts(); }, [reloadContacts]);

  const pickAccount = () => {
    setMode("account");
    if (isContactValue(value)) onChange("");
  };
  const pickContact = () => {
    setMode("contact");
    if (!isContactValue(value)) onChange("");
  };

  const selectedContactId = contactIdFromValue(value);

  return (
    <div className={className} data-testid={testId}>
      {label ? <label className="block font-semibold text-slate-700 mb-1">{label}</label> : null}
      <div className="flex gap-1 mb-1.5" data-testid={`${testId}-mode`}>
        <button
          type="button"
          onClick={pickAccount}
          disabled={disabled}
          className={`flex-1 px-2 py-1 rounded-md border text-[10px] font-bold ${mode === "account" ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
          data-testid={`${testId}-mode-account`}
        >
          Hesap / Ortak
        </button>
        <button
          type="button"
          onClick={pickContact}
          disabled={disabled}
          className={`flex-1 px-2 py-1 rounded-md border text-[10px] font-bold ${mode === "contact" ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}
          data-testid={`${testId}-mode-contact`}
        >
          Cari
        </button>
      </div>
      {mode === "account" ? (
        <PaymentTargetSelect
          companyId={companyId}
          accounts={accounts}
          value={isContactValue(value) ? "" : (value || "")}
          onChange={onChange}
          testId={`${testId}-account`}
          includePartners={includePartners}
          includeContacts={false}
          excludeIntegrated={excludeIntegrated}
          disabled={disabled}
          emptyLabel={emptyLabel}
        />
      ) : (
        <SearchSelect
          value={selectedContactId}
          onChange={(id) => onChange(id ? `contact:${id}` : "")}
          options={contacts}
          placeholder="Cari ara (ad, VKN, telefon)…"
          searchPlaceholder="Cari adı, VKN veya telefon ara…"
          getLabel={(c) => c.name || c.company_title || "Cari"}
          getSub={(c) => {
            const kind = CONTACT_TYPE_LABEL[c.type] || "Cari";
            const tax = c.tax_number || c.tax || "";
            const phone = c.phone || "";
            const bal = `${fmt(c.balance)} ₺`;
            return [kind, tax, phone, bal].filter(Boolean).join(" · ");
          }}
          clearable
          clearLabel="Cari seçimini kaldır"
          testId={`${testId}-contact`}
          className="w-full"
        />
      )}
    </div>
  );
};
