import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { QuickMessageModal, TEMPLATES } from "../components/QuickMessageModal";
import { ContactLocationModal, mapsLink } from "../components/ContactLocationModal";
import { ContactDetailPanel } from "../components/ContactDetailPanel";
import { ContactRow } from "../components/ContactRow";
import { ContactForm } from "../components/ContactForm";
import { ExportButtons } from "../components/ExportButtons";
import { StatementShareBar, buildStatementRows } from "../components/StatementShare";
import { useEscape } from "../utils/useEscape";
import { useSearchParams } from "react-router-dom";
import { cachedList, contactTypeFilter } from "../utils/dataSync";
import { useInfiniteRows } from "../hooks/useInfiniteRows";

import {
  Users,
  Plus,
  Search,
  Building,
  Phone,
  Mail,
  MapPin,
  TrendingUp,
  TrendingDown,
  FileText,
  X,
  CreditCard,
  ShieldCheck,
  ChevronRight,
  MessageSquare,
  Navigation,
  Filter
} from "lucide-react";
import { useDataRefresh } from "../utils/dataRefresh";
import { fmtMoney } from "../utils/money";
const CONTACT_COLS = [{ key: "name", label: "Ünvan" }, { label: "Tip", value: (r) => r.type === "customer" ? "Müşteri" : r.type === "supplier" ? "Tedarikçi" : "Müşteri & Tedarikçi" }, { key: "tax_number_or_id", label: "VKN/TCKN" }, { key: "tax_office", label: "Vergi Dairesi" }, { key: "phone", label: "Telefon" }, { key: "email", label: "E-posta" }, { key: "city", label: "Şehir" }, { key: "address", label: "Adres" }, { key: "balance", label: "Bakiye", num: true }, { label: "E-Fatura", value: (r) => r.is_e_invoice_user ? "Evet" : "Hayır" }];

export default function ContactsPage() {
  const { activeCompany } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [filterType, setFilterType] = useState("all");
  const [flags, setFlags] = useState({});
  const [finFilter, setFinFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState(() => new URLSearchParams(window.location.search).get("search") || "");
  const [loading, setLoading] = useState(true);
  const [messageContact, setMessageContact] = useState(null);
  const [locationContact, setLocationContact] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const detailContactId = searchParams.get("contact_id");
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedContactStatement, setSelectedContactStatement] = useState(null);
  useEscape(React.useCallback(() => setSelectedContactStatement(null), []));
  const [statementData, setStatementData] = useState(null);

  const [editContact, setEditContact] = useState(null);

  const loadContacts = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const cid = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
      const rows = await cachedList("contacts", cid, { filter: contactTypeFilter(filterType), onCached: setContacts });
      axios.get(`${API_URL}/contacts/flags?company_id=${cid}`).then((r) => setFlags(r.data)).catch(() => {});
      setContacts(rows);
    } catch (err) {
      if (!silent) toast.error("Cari listesi yüklenemedi.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeCompany, filterType]);
  useEffect(() => { loadContacts(); }, [loadContacts]);
  const refreshContactsSilent = useCallback(() => loadContacts({ silent: true }), [loadContacts]);
  useDataRefresh(refreshContactsSilent, { companyId, scopes: ["cash", "contacts", "invoices"] });


  const openStatement = async (contact) => {
    setSelectedContactStatement(contact);
    try {
      const res = await axios.get(`${API_URL}/contacts/${contact.id || contact._id}/statement`);
      setStatementData(res.data);
    } catch (err) {
      toast.error("Ekstre yüklenemedi.");
    }
  };

  const finMatch = (c) => { const f = flags[c.id] || {}; switch (finFilter) { case "debtors": return (c.balance || 0) > 0; case "creditors": return (c.balance || 0) < 0; case "overdue": return f.overdue_count > 0 || f.installment_overdue_count > 0; case "installments": return f.installment_due_count > 0; case "clear": return !(c.balance || 0); default: return true; } };
  const FIN_FILTERS = [["all", "Tümü", contacts.length], ["debtors", "Bize Borçlu (Alacağımız var)", contacts.filter((c) => (c.balance || 0) > 0).length], ["creditors", "Bize Alacaklı (Borcumuz var)", contacts.filter((c) => (c.balance || 0) < 0).length], ["overdue", "Vadesi Geçenler", contacts.filter((c) => (flags[c.id]?.overdue_count || 0) > 0 || (flags[c.id]?.installment_overdue_count || 0) > 0).length], ["installments", "Taksit Ödemesi Gelenler (7 gün)", contacts.filter((c) => (flags[c.id]?.installment_due_count || 0) > 0).length], ["clear", "Bakiyesi Sıfır", contacts.filter((c) => !(c.balance || 0)).length]];
  const filtered = contacts.filter((c) => finMatch(c)).filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.company_title && c.company_title.toLowerCase().includes(searchTerm.toLowerCase())) ||
    c.tax_number_or_id.includes(searchTerm)
  );
  const { visible: pagedContacts, hasMore: contactsHasMore, sentinelRef: contactsSentinelRef } = useInfiniteRows(filtered, {
    resetKey: `${filterType}|${finFilter}|${searchTerm}`,
  });

  return (
    <div className="space-y-6" data-testid="contacts-page">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Cari Hesaplar</h1>
          <p className="text-xs sm:text-sm text-slate-500">Müşteriler, Tedarikçiler, Bayiler ve Cari Ekstre Yönetimi</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition self-start sm:self-auto"
          data-testid="add-contact-btn"
        >
          <Plus className="w-4 h-4" />
          <span>Yeni Cari Ekle</span>
        </button>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2 text-xs">
          {[
            { id: "all", label: "Tüm Cariler" },
            { id: "customer", label: "Müşteriler" },
            { id: "supplier", label: "Tedarikçiler" }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setFilterType(t.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                filterType === t.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={`contact-filter-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <ExportButtons rows={filtered} columns={CONTACT_COLS} filename="cariler" title="Cari Listesi" />
        <div className="flex items-center gap-2 text-xs" data-testid="contact-fin-filters">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={finFilter}
            onChange={(e) => setFinFilter(e.target.value)}
            className={`border rounded-lg px-2.5 py-1.5 font-medium outline-none focus:ring-2 focus:ring-emerald-500 ${finFilter === "overdue" ? "bg-rose-50 border-rose-200 text-rose-700" : finFilter === "installments" ? "bg-violet-50 border-violet-200 text-violet-700" : finFilter !== "all" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-white border-slate-200 text-slate-700"}`}
            data-testid="contact-fin-filter-select"
          >
            {FIN_FILTERS.map(([k, l, n]) => <option key={k} value={k} data-testid={`contact-fin-filter-${k}`}>{l} ({n})</option>)}
          </select>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Cari adı, unvan veya VKN ile ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-xl text-xs w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            data-testid="contact-search-input"
          />
        </div>
      </div>

      {/* Contacts List (horizontal rows) */}
      <div className="space-y-2" data-testid="contacts-list">
        {filtered.length === 0 && <div className="bg-white rounded-xl border p-8 text-center text-sm text-slate-400" data-testid="contacts-empty">Filtreye uyan cari yok.</div>}
        {pagedContacts.map((contact) => (
          <ContactRow key={contact.id || contact._id} contact={contact} flag={flags[contact.id]} onOpen={() => setSearchParams({ contact_id: contact.id })} onEdit={() => setEditContact(contact)} onMessage={() => setMessageContact(contact)} onStatement={() => openStatement(contact)} onLocation={() => setLocationContact(contact)} />
        ))}
        {contactsHasMore && (
          <div ref={contactsSentinelRef} className="py-3 text-center text-[11px] text-slate-400" data-testid="contacts-load-more">
            Daha fazla cari yükleniyor…
          </div>
        )}
      </div>

      {detailContactId && (
        <ContactDetailPanel contactId={detailContactId} onClose={() => setSearchParams({})} onMessage={(c) => setMessageContact(c)} />
      )}
      {messageContact && (
        <QuickMessageModal
          companyId={companyId}
          recipient={{ contact_id: messageContact.id, name: messageContact.name, phone: messageContact.phone, email: messageContact.email }}
          defaultSubject="Cari Hesap Bakiye Bilgilendirmesi"
          defaultMessage={TEMPLATES.balance(messageContact)}
          context="contact"
          refId={messageContact.id}
          onClose={() => setMessageContact(null)}
        />
      )}
      {locationContact && (
        <ContactLocationModal
          contact={locationContact}
          onClose={() => setLocationContact(null)}
          onSaved={(updated) => setContacts(contacts.map((c) => (c.id === updated.id ? updated : c)))}
        />
      )}

      {(showAddModal || editContact) && <ContactForm companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} contact={editContact} onClose={() => { setShowAddModal(false); setEditContact(null); }} onSaved={() => { setShowAddModal(false); setEditContact(null); loadContacts(); }} />}

      {/* CARİ EKSTRESİ MODAL */}
      {selectedContactStatement && statementData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-[min(1680px,calc(100vw-2rem))] w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto" data-testid="statement-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="text-base font-bold text-slate-900">{selectedContactStatement.name} - Cari Ekstresi</h3>
                <p className="text-xs text-slate-500">VKN: {selectedContactStatement.tax_number_or_id} • Bakiye: {fmtMoney(selectedContactStatement.balance, selectedContactStatement.currency || "TRY")}</p>
              </div>
              <button onClick={() => setSelectedContactStatement(null)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <StatementShareBar contact={selectedContactStatement} rows={buildStatementRows(statementData)} companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"} />

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between"><h4 className="font-bold text-slate-800">Hesap Hareketleri (Fatura & Ödeme)</h4><div className="flex items-center gap-2 text-[10px] font-semibold"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" /> Fatura (Borç)</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Tahsilat / Ödeme</span></div></div>
              <table className="w-full text-left" data-testid="statement-table">
                <thead className="bg-slate-50 border-b text-slate-500 uppercase font-semibold">
                  <tr>
                    <th className="py-2 px-3">Tarih</th>
                    <th className="py-2 px-3">Belge / Açıklama</th>
                    <th className="py-2 px-3 text-right">Borç</th>
                    <th className="py-2 px-3 text-right">Alacak</th>
                    <th className="py-2 px-3 text-right">Bakiye</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {buildStatementRows(statementData).length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Hareket yok.</td></tr>}
                  {buildStatementRows(statementData).map((r, idx) => (
                    <tr key={idx} className={r.kind === "payment" ? "bg-emerald-50/50" : ""} data-testid={`statement-row-${r.kind}-${idx}`}>
                      <td className="py-2 px-3 text-slate-500 font-mono">{r.date}</td>
                      <td className="py-2 px-3 font-semibold text-slate-800"><span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${r.kind === "payment" ? "bg-emerald-500" : "bg-rose-500"}`} />{r.doc}</td>
                      <td className="py-2 px-3 text-right font-medium text-rose-700">{r.debit ? fmtMoney(r.debit, selectedContactStatement.currency || "TRY") : '-'}</td>
                      <td className="py-2 px-3 text-right font-medium text-emerald-700">{r.credit ? fmtMoney(r.credit, selectedContactStatement.currency || "TRY") : '-'}</td>
                      <td className={`py-2 px-3 text-right font-bold ${r.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmtMoney(r.balance, selectedContactStatement.currency || "TRY")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2 border-t">
              <button
                onClick={() => setSelectedContactStatement(null)}
                className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
