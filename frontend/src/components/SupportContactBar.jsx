import React from "react";
import { Headset } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { HeaderFxRates } from "./HeaderFxRates";
import { GlobalSearch } from "./HeaderQuickActions";

/**
 * Utility strip under the main header: FX rates, global search, support contact.
 * Keeps the sticky header lean while preserving one-click access.
 */
export const SupportContactBar = ({ companyId }) => {
  const { license, addonOn } = useAuth();
  const tickets = addonOn?.("support.tickets");
  const contact = addonOn?.("support.contact");
  const s = license?.support;
  const hasContact = contact && s && (s.email || s.phone);
  const showSupport = tickets || hasContact;
  const href = s?.email
    ? `mailto:${s.email}?subject=${encodeURIComponent("Destek talebi")}`
    : (s?.phone ? `tel:${s.phone}` : null);

  return (
    <div
      className="mx-4 sm:mx-6 lg:mx-8 mt-3 bg-white border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 sm:gap-3"
      data-testid="support-contact-bar"
    >
      <HeaderFxRates companyId={companyId} />
      <GlobalSearch companyId={companyId} className="min-w-[12rem] sm:min-w-[16rem]" />
      {showSupport && (
        <div className="ml-auto flex flex-wrap items-center gap-2 shrink-0" data-testid="support-contact-actions">
          <span className="flex items-center gap-1.5" data-testid="support-contact-label">
            <Headset className="w-3.5 h-3.5 text-amber-600" />
            <b>Destek</b>
          </span>
          {tickets ? (
            <Link to="/support" className="px-3 py-1 bg-amber-400 text-slate-900 rounded-lg font-bold" data-testid="support-contact-link">Talep oluştur</Link>
          ) : href ? (
            <a href={href} className="px-3 py-1 bg-amber-400 text-slate-900 rounded-lg font-bold" data-testid="support-contact-link">Talep oluştur</a>
          ) : null}
        </div>
      )}
    </div>
  );
};
