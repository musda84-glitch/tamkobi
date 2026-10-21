import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, LogOut } from "lucide-react";
import { resolveImageUrl } from "../utils/imageUrl";
import { logoutB2B, supplierAvatarClass, supplierCartUnits, supplierInitials } from "../utils/b2bSession";
import { useEscape } from "../utils/useEscape";

export function SupplierFace({ name, logoUrl, className = "w-10 h-10 text-xs" }) {
  if (logoUrl) {
    return (
      <img
        src={resolveImageUrl(logoUrl)}
        alt=""
        className={`${className} rounded-xl object-contain bg-white border border-slate-200 shrink-0`}
      />
    );
  }
  return (
    <span className={`${className} rounded-xl inline-flex items-center justify-center font-black text-white shrink-0 ${supplierAvatarClass(name)}`}>
      {supplierInitials(name)}
    </span>
  );
}

export function cartBadgeText(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return `Sepette ${n} ürün`;
}

export default function B2BSupplierSwitch({ suppliers, currentCompany, currentContact, busyId, error, onPick }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEscape(() => setOpen(false));

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => {
      if (box.current && !box.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = (suppliers || []).find((row) => (
    String(row.company_name || "") === String(currentCompany || "")
    && String(row.contact_name || "") === String(currentContact || "")
  )) || (suppliers || []).find((row) => String(row.company_name || "") === String(currentCompany || ""));
  const label = current?.company_name || currentCompany || "Tedarikçi";

  return (
    <div className="relative min-w-0 w-full sm:w-72" ref={box}>
      <button
        type="button"
        className="w-full min-w-0 flex items-center gap-2 rounded-xl bg-white text-slate-900 px-2.5 py-1.5 text-left shadow-sm"
        data-testid="b2b-switch-supplier"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SupplierFace name={label} logoUrl={current?.logo_url} className="w-8 h-8 text-[10px]" />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-wide text-emerald-700">Tedarikçi değiştir</span>
          <span className="block text-xs font-bold truncate">{label}</span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-500 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {error ? (
        <p className="mt-1 text-[11px] text-rose-200 bg-rose-950/40 rounded-lg px-2 py-1" data-testid="b2b-switch-error">{error}</p>
      ) : null}
      {open && (
        <div
          className="absolute left-0 right-0 z-40 mt-2 bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-2xl overflow-hidden"
          role="menu"
          data-testid="b2b-switch-menu"
        >
          <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Tedarikçi değiştir</div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {(suppliers || []).map((row) => {
              const active = row.contact_id && row.contact_id === current?.contact_id;
              const count = supplierCartUnits(row.contact_id);
              return (
                <li key={row.contact_id || row.company_name}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={!!busyId}
                    onClick={() => { setOpen(false); onPick?.(row); }}
                    className="w-full min-w-0 flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-60"
                    data-testid={`b2b-switch-item-${row.contact_id}`}
                  >
                    <SupplierFace name={row.company_name} logoUrl={row.logo_url} className="w-8 h-8 text-[10px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold truncate">{row.company_name}</span>
                      <span className="block text-[11px] text-slate-500 truncate">Cari: {row.contact_name}</span>
                    </span>
                    {count > 0 ? (
                      <span className="shrink-0 min-w-[1.25rem] h-5 px-1 rounded-full bg-emerald-600 text-white text-[10px] font-black inline-flex items-center justify-center" data-testid={`b2b-switch-count-${row.contact_id}`}>
                        {count}
                      </span>
                    ) : null}
                    {active ? <Check className="w-4 h-4 shrink-0 text-emerald-600" aria-label="Seçili" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-100 px-3 py-2 flex items-center justify-between gap-2">
            <Link to="/b2b/tedarikci" className="text-xs font-bold text-emerald-700 hover:underline min-w-0 truncate" data-testid="b2b-switch-all" onClick={() => setOpen(false)}>
              Tüm tedarikçileri gör →
            </Link>
            <button
              type="button"
              onClick={logoutB2B}
              className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
              data-testid="b2b-portal-logout"
            >
              <LogOut className="w-3.5 h-3.5" /> Çıkış
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
