import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
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
  Navigation
} from "lucide-react";
import { QuickMessageModal, TEMPLATES } from "../components/QuickMessageModal";
import { ContactLocationModal, mapsLink } from "../components/ContactLocationModal";
import { ContactDetailPanel } from "../components/ContactDetailPanel";
import { StatementShareBar, buildStatementRows } from "../components/StatementShare";
import { useEscape } from "../utils/useEscape";
import { useSearchParams } from "react-router-dom";

export default function ContactsPage() {
  const { activeCompany } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [filterType, setFilterType] = useState("all");
  const [flags, setFlags] = useState({});
  const [finFilter, setFinFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
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

  const [newContact, setNewContact] = useState({
    type: "customer",
    name: "",
    company_title: "",
    tax_number_or_id: "",
    tax_office: "",
    email: "",
    phone: "",
    address: "",
    city: "İstanbul",
    district: "Kadıköy",
    credit_limit: 50000.0,
    category: "Genel Bayi",
    is_e_invoice_user: true,
    notes: ""
  });

  const loadContacts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/contacts?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}&type=${filterType}`);
      axios.get(`${API_URL}/contacts/flags?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`).then((r) => setFlags(r.data)).catch(() => {});
      setContacts(res.data);
    } catch (err) {
      toast.error("Cari listesi yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [activeCompany, filterType]);
  useEffect(() => { loadContacts(); }, [loadContacts]);

  const handleSaveContact = async (e) => {
    e.preventDefault();
    if (!newContact.name || !newContact.tax_number_or_id) {
      toast.error("Lütfen cari adını ve Vergi/TC kimlik numarasını girin.");
      return;
    }
    try {
      await axios.post(`${API_URL}/contacts`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        ...newContact
      });
      toast.success("Cari kartı başarıyla kaydedildi.");
      setShowAddModal(false);
      loadContacts();
    } catch (err) {
      toast.error("Cari kaydedilemedi.");
    }
  };

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
        <div className="flex items-center gap-1.5 flex-wrap text-xs" data-testid="contact-fin-filters">
          {FIN_FILTERS.map(([k, l, n]) => (
            <button key={k} onClick={() => setFinFilter(k)} className={`px-2.5 py-1.5 rounded-lg font-medium transition border ${finFilter === k ? (k === "overdue" ? "bg-rose-600 border-rose-600 text-white" : k === "installments" ? "bg-violet-600 border-violet-600 text-white" : "bg-emerald-600 border-emerald-600 text-white") : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`} data-testid={`contact-fin-filter-${k}`}>{l} <span className={finFilter === k ? "opacity-80" : "text-slate-400"}>({n})</span></button>
          ))}
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

      {/* Contacts List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((contact) => (
          <div
            key={contact.id || contact._id}
            className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md transition space-y-3 flex flex-col justify-between"
            data-testid={`contact-card-${contact.tax_number_or_id}`}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                    contact.type === 'customer' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {contact.type === 'customer' ? 'Müşteri' : 'Tedarikçi'}
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-1 cursor-pointer hover:text-emerald-700 hover:underline" onClick={() => setSearchParams({ contact_id: contact.id })} data-testid={`contact-name-${contact.tax_number_or_id}`}>{contact.name}</h3>
                  <div className="text-xs text-slate-500">{contact.company_title || contact.category}</div>
                  {(flags[contact.id]?.overdue_count > 0 || flags[contact.id]?.installment_due_count > 0) && (
                    <div className="flex flex-wrap gap-1 mt-1" data-testid={`contact-flags-${contact.tax_number_or_id}`}>
                      {flags[contact.id]?.overdue_count > 0 && <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded font-semibold">Vadesi geçti: {(flags[contact.id].overdue_amount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺</span>}
                      {flags[contact.id]?.installment_due_count > 0 && <span className="text-[10px] bg-violet-50 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded font-semibold">{flags[contact.id].installment_due_count} taksit yaklaşıyor{flags[contact.id].installment_overdue_count ? ` (${flags[contact.id].installment_overdue_count} gecikmiş)` : ""}</span>}
                    </div>
                  )}
                </div>
                {contact.is_e_invoice_user && (
                  <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-mono font-medium" title="E-Fatura Mükellefi">
                    E-Fatura
                  </span>
                )}
              </div>

              <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
                <div className="flex items-center gap-2">
                  <Building className="w-3.5 h-3.5 text-slate-400" />
                  <span>VKN/TCKN: {contact.tax_number_or_id} ({contact.tax_office || 'V.D.'})</span>
                </div>
                {contact.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{contact.phone}</span>
                  </div>
                )}
                {contact.email && (
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span>{contact.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  {mapsLink(contact) ? (
                    <a href={mapsLink(contact)} target="_blank" rel="noreferrer" className="text-rose-600 font-semibold hover:underline flex items-center gap-1" data-testid={`location-link-${contact.tax_number_or_id}`}><Navigation className="w-3 h-3" /> Konuma Git</a>
                  ) : (
                    <span className="text-slate-400">Konum eklenmedi</span>
                  )}
                  <button onClick={() => setLocationContact(contact)} className="ml-auto text-[10px] text-slate-500 hover:text-rose-600 font-semibold" data-testid={`location-btn-${contact.tax_number_or_id}`}>{mapsLink(contact) ? "Düzenle" : "+ Konum Ekle"}</button>
                </div>
              </div>
            </div>

            {/* Balance & Action */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Cari Bakiye</span>
                <div className={`text-base font-bold ${
                  contact.balance > 0 ? 'text-emerald-600' : contact.balance < 0 ? 'text-rose-600' : 'text-slate-700'
                }`}>
                  {contact.balance > 0 ? `+${contact.balance.toLocaleString('tr-TR')} ₺ (Alacak)` : contact.balance < 0 ? `${contact.balance.toLocaleString('tr-TR')} ₺ (Borç)` : '0.00 ₺'}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
              <button
                onClick={() => setMessageContact(contact)}
                className="p-1.5 text-slate-600 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg transition"
                title="SMS / E-posta Gönder"
                data-testid={`message-btn-${contact.tax_number_or_id}`}
              >
                <MessageSquare className="w-4 h-4" />
              </button>
              <button
                onClick={() => openStatement(contact)}
                className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
                data-testid={`statement-btn-${contact.tax_number_or_id}`}
              >
                <span>Ekstre</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              </div>
            </div>
          </div>
        ))}
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

      {/* ADD CONTACT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="add-contact-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h2 className="text-base font-bold text-slate-900">Yeni Cari Kartı Oluştur</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveContact} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cari Türü</label>
                  <select
                    value={newContact.type}
                    onChange={(e) => setNewContact({ ...newContact, type: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                    data-testid="contact-type-select"
                  >
                    <option value="customer">Müşteri</option>
                    <option value="supplier">Tedarikçi</option>
                    <option value="both">Her İkisi</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kategori</label>
                  <input
                    type="text"
                    value={newContact.category}
                    onChange={(e) => setNewContact({ ...newContact, category: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cari Adı / Ünvan</label>
                <input
                  type="text"
                  placeholder="Örn: Trend Mağazacılık A.Ş."
                  value={newContact.name}
                  onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="contact-name-input"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">VKN / TCKN</label>
                  <input
                    type="text"
                    placeholder="10 veya 11 haneli"
                    value={newContact.tax_number_or_id}
                    onChange={(e) => setNewContact({ ...newContact, tax_number_or_id: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                    data-testid="contact-tax-input"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Vergi Dairesi</label>
                  <input
                    type="text"
                    placeholder="Örn: Beşiktaş"
                    value={newContact.tax_office}
                    onChange={(e) => setNewContact({ ...newContact, tax_office: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Telefon</label>
                  <input
                    type="text"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">E-Posta</label>
                  <input
                    type="email"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Açık Adres</label>
                <textarea
                  rows="2"
                  value={newContact.address}
                  onChange={(e) => setNewContact({ ...newContact, address: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-contact-btn"
                >
                  Cariyi Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CARİ EKSTRESİ MODAL */}
      {selectedContactStatement && statementData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto" data-testid="statement-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="text-base font-bold text-slate-900">{selectedContactStatement.name} - Cari Ekstresi</h3>
                <p className="text-xs text-slate-500">VKN: {selectedContactStatement.tax_number_or_id} • Bakiye: {selectedContactStatement.balance?.toLocaleString('tr-TR')} ₺</p>
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
                    <th className="py-2 px-3 text-right">Borç (₺)</th>
                    <th className="py-2 px-3 text-right">Alacak (₺)</th>
                    <th className="py-2 px-3 text-right">Bakiye (₺)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {buildStatementRows(statementData).length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Hareket yok.</td></tr>}
                  {buildStatementRows(statementData).map((r, idx) => (
                    <tr key={idx} className={r.kind === "payment" ? "bg-emerald-50/50" : ""} data-testid={`statement-row-${r.kind}-${idx}`}>
                      <td className="py-2 px-3 text-slate-500 font-mono">{r.date}</td>
                      <td className="py-2 px-3 font-semibold text-slate-800"><span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${r.kind === "payment" ? "bg-emerald-500" : "bg-rose-500"}`} />{r.doc}</td>
                      <td className="py-2 px-3 text-right font-medium text-rose-700">{r.debit ? `${r.debit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className="py-2 px-3 text-right font-medium text-emerald-700">{r.credit ? `${r.credit.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}` : '-'}</td>
                      <td className={`py-2 px-3 text-right font-bold ${r.balance > 0 ? "text-rose-700" : "text-emerald-700"}`}>{r.balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
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
