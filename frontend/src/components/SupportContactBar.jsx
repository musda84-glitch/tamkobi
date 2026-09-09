import React from "react";
import { Headset } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export const SupportContactBar = () => {
  const { license, addonOn } = useAuth();
  const tickets = addonOn?.("support.tickets");
  const contact = addonOn?.("support.contact");
  if (!tickets && !contact) return null;
  const s = license?.support;
  const hasContact = contact && s && (s.email || s.phone);
  if (!tickets && !hasContact) return null;
  const href = s?.email ? `mailto:${s.email}?subject=${encodeURIComponent("Destek talebi")}` : (s?.phone ? `tel:${s.phone}` : null);
  return (
    <div className="mx-4 sm:mx-6 lg:mx-8 mt-3 bg-white border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2" data-testid="support-contact-bar">
      <span className="flex items-center gap-1.5"><Headset className="w-3.5 h-3.5 text-amber-600" /> <b>Destek</b>{hasContact && s.email ? ` · ${s.email}` : ""}{hasContact && s.phone ? ` · ${s.phone}` : ""}</span>
      {tickets ? <Link to="/support" className="px-3 py-1 bg-amber-400 text-slate-900 rounded-lg font-bold" data-testid="support-contact-link">Talep oluştur</Link>
        : href && <a href={href} className="px-3 py-1 bg-amber-400 text-slate-900 rounded-lg font-bold" data-testid="support-contact-link">Talep oluştur</a>}
    </div>
  );
};
