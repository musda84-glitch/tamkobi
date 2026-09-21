
import React, { useState } from "react";
import { Building, Phone, Mail, MapPin, Navigation, MessageSquare, ChevronRight, Pencil, Link2, FileDown } from "lucide-react";
import { mapsLink } from "./ContactLocationModal";
import { resolveImageUrl } from "../utils/imageUrl";
import { downloadStatementPdf, shareStatementLink } from "../utils/statementShare";
import { toast } from "sonner";

const money = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

export const ContactRow = ({ contact, flag, onOpen, onEdit, onMessage, onStatement, onLocation }) => {
  const tid = contact.tax_number_or_id;
  const bal = Number(contact.balance) || 0;
  const [shareBusy, setShareBusy] = useState("");
  const share = async (kind) => {
    setShareBusy(kind);
    try {
      if (kind === "link") await shareStatementLink(contact);
      else await downloadStatementPdf(contact);
    } catch (err) {
      toast.error(err.response?.data?.detail || (kind === "link" ? "Link oluşturulamadı." : "PDF indirilemedi."));
    } finally {
      setShareBusy("");
    }
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200/90 shadow-sm hover:shadow-md hover:border-emerald-200 transition grid grid-cols-12 gap-3 items-center px-4 py-3" data-testid={`contact-card-${tid}`}>
      <div className="col-span-12 md:col-span-4 flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center font-black text-sm overflow-hidden ${contact.type === "customer" ? "bg-blue-50 text-blue-700" : contact.type === "supplier" ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700"}`}>{contact.logo_url ? <img src={resolveImageUrl(contact.logo_url)} alt="" className="w-full h-full object-contain bg-white" /> : (contact.name?.slice(0, 2).toUpperCase())}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-bold text-slate-900 cursor-pointer hover:text-emerald-700 hover:underline truncate" onClick={onOpen} data-testid={`contact-name-${tid}`}>{contact.name}</h3>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${contact.type === "customer" ? "bg-blue-50 text-blue-700" : contact.type === "supplier" ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700"}`}>{contact.type === "customer" ? "Müşteri" : contact.type === "supplier" ? "Tedarikçi" : "Müşteri & Ted."}</span>
            {contact.is_e_invoice_user && <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono font-medium" title="E-Fatura Mükellefi">E-Fatura</span>}
          </div>
          <div className="text-[11px] text-slate-500 truncate">{contact.company_title || contact.category}</div>
          {(flag?.overdue_count > 0 || flag?.installment_due_count > 0) && (
            <div className="flex flex-wrap gap-1 mt-1" data-testid={`contact-flags-${tid}`}>
              {flag.overdue_count > 0 && <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded font-semibold">Vadesi geçti: {money(flag.overdue_amount)} ₺</span>}
              {flag.installment_due_count > 0 && <span className="text-[10px] bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded font-semibold">{flag.installment_due_count} taksit yaklaşıyor{flag.installment_overdue_count ? ` (${flag.installment_overdue_count} gecikmiş)` : ""}</span>}
            </div>
          )}
        </div>
      </div>
      <div className="col-span-12 md:col-span-4 text-xs text-slate-600 grid grid-cols-2 gap-x-3 gap-y-1">
        <div className="flex items-center gap-1.5 col-span-2 truncate"><Building className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span className="truncate">VKN/TCKN: {tid} ({contact.tax_office || "V.D."})</span></div>
        <div className="flex items-center gap-1.5 truncate"><Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span className="truncate">{contact.phone || "-"}</span></div>
        <div className="flex items-center gap-1.5 truncate"><Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" /><span className="truncate">{contact.email || "-"}</span></div>
        <div className="flex items-center gap-1.5 col-span-2"><MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {mapsLink(contact) ? <a href={mapsLink(contact)} target="_blank" rel="noreferrer" className="text-rose-600 font-semibold hover:underline flex items-center gap-1" data-testid={`location-link-${tid}`}><Navigation className="w-3 h-3" /> Konuma Git</a> : <span className="text-slate-400">Konum eklenmedi</span>}
          <button onClick={onLocation} className="text-[10px] text-slate-500 hover:text-rose-600 font-semibold" data-testid={`location-btn-${tid}`}>{mapsLink(contact) ? "Düzenle" : "+ Konum Ekle"}</button>
        </div>
      </div>
      <div className="col-span-6 md:col-span-2 text-right md:text-left">
        <span className="text-[10px] text-slate-400 uppercase font-semibold">Cari Bakiye</span>
        <div className={`text-sm font-bold whitespace-nowrap ${bal > 0 ? "text-emerald-600" : bal < 0 ? "text-rose-600" : "text-slate-700"}`} data-testid={`contact-balance-${tid}`}>
          {bal > 0 ? `+${money(bal)} ₺` : `${money(bal)} ₺`}<span className="text-[10px] font-semibold text-slate-400 ml-1">{bal > 0 ? "Alacak" : bal < 0 ? "Borç" : ""}</span>
        </div>
      </div>
      <div className="col-span-6 md:col-span-2 flex items-center justify-end gap-1.5 flex-wrap">
        {onEdit && <button onClick={onEdit} className="p-1.5 text-slate-600 hover:text-emerald-700 bg-slate-50 hover:bg-emerald-50 rounded-lg transition" title="Gelişmiş cari bilgilerini güncelle" data-testid={`edit-contact-btn-${tid}`}><Pencil className="w-4 h-4" /></button>}
        <button onClick={onMessage} className="p-1.5 text-slate-600 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition" title="SMS / E-posta Gönder" data-testid={`message-btn-${tid}`}><MessageSquare className="w-4 h-4" /></button>
        <button type="button" onClick={() => share("link")} disabled={!!shareBusy} className="flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-1.5 rounded-lg transition disabled:opacity-50" title="Hesap ekstresi paylaşım linki" data-testid={`statement-link-btn-${tid}`}><Link2 className="w-3.5 h-3.5" />{shareBusy === "link" ? "…" : "Link"}</button>
        <button type="button" onClick={() => share("pdf")} disabled={!!shareBusy} className="flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 px-2 py-1.5 rounded-lg transition disabled:opacity-50" title="Hesap ekstresini PDF indir" data-testid={`statement-pdf-btn-${tid}`}><FileDown className="w-3.5 h-3.5" />{shareBusy === "pdf" ? "…" : "PDF"}</button>
        <button onClick={onStatement} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition" data-testid={`statement-btn-${tid}`}><span>Ekstre</span><ChevronRight className="w-3.5 h-3.5" /></button>
        <button onClick={onOpen} className="p-1.5 text-slate-500 hover:text-emerald-700 bg-slate-50 hover:bg-emerald-50 rounded-lg transition" title="Cari Kartı Aç" data-testid={`open-contact-btn-${tid}`}><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
};
