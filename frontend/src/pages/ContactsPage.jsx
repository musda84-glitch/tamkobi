import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { StatementTxList, StatementViewProvider } from "../components/StatementTxList";
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
import { isContactsServerPagingEnabled } from "../utils/featureFlags";
import { activeCompanyId } from "../utils/activeCompanyId";
import NoCompanyNotice from "../components/NoCompanyNotice";
const CONTACT_PAGE_SIZES = [20, 50, 100];
const EMPTY_CONTACT_ROWS = [];
const CONTACT_COLS = [{ key: "name", label: "Ünvan" }, { label: "Tip", value: (r) => r.type === "customer" ? "Müşteri" : r.type === "supplier" ? "Tedarikçi" : "Müşteri & Tedarikçi" }, { label: "Durum", value: (r) => r.is_active === false ? "Pasif" : "Aktif" }, { key: "tax_number_or_id", label: "VKN/TCKN" }, { key: "tax_office", label: "Vergi Dairesi" }, { key: "phone", label: "Telefon" }, { key: "email", label: "E-posta" }, { key: "city", label: "Şehir" }, { key: "address", label: "Adres" }, { key: "balance", label: "Bakiye", num: true }, { label: "E-Fatura", value: (r) => r.is_e_invoice_user ? "Evet" : "Hayır" }];

function contactTotalPages(total, pageSize) {
  const size = Number(pageSize) > 0 ? Number(pageSize) : 1;
  return Math.max(1, Math.ceil((Number(total) || 0) / size) || 1);
}

function withoutContactSearchParams(prev) {
  const next = new URLSearchParams(prev);
  next.delete("search");
  next.delete("q");
  return next.toString() === prev.toString() ? prev : next;
}

export default function ContactsPage() {
  const { activeCompany } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const detailContactId = searchParams.get("contact_id");
  const [contacts, setContacts] = useState([]);
  const [filterType, setFilterType] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [flags, setFlags] = useState({});
  const [finFilter, setFinFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get("search") || "");
  const [loading, setLoading] = useState(true);
  const [messageContact, setMessageContact] = useState(null);
  const [locationContact, setLocationContact] = useState(null);
  const companyId = activeCompanyId(activeCompany);
  const serverPaging = isContactsServerPagingEnabled();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState("name");
  const [serverTotal, setServerTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const serverGen = useRef(0);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedContactStatement, setSelectedContactStatement] = useState(null);
  useEscape(React.useCallback(() => setSelectedContactStatement(null), []));
  const [statementData, setStatementData] = useState(null);
  const statementRows = statementData ? buildStatementRows(statementData) : [];

  const [editContact, setEditContact] = useState(null);

  const loadContacts = useCallback(async ({ silent = false } = {}) => {
    const cid = activeCompanyId(activeCompany);
    if (!cid) {
      if (!silent) setLoading(false);
      return;
    }
    try {
      if (!silent) setLoading(true);
      const rows = await cachedList("contacts", cid, { filter: contactTypeFilter(filterType), onCached: setContacts });
      axios.get(`${API_URL}/contacts/flags?company_id=${cid}`).then((r) => setFlags(r.data)).catch(() => {});
      setContacts(rows);
    } catch (err) {
      if (!silent) toast.error("Cari listesi yüklenemedi.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeCompany, filterType]);
  useEffect(() => { if (!serverPaging) loadContacts(); }, [loadContacts, serverPaging]);
  const filterKey = `${companyId}|${searchTerm}|${filterType}|${statusFilter}|${finFilter}|${sort}|${pageSize}`;
  const filterKeyRef = useRef(filterKey);
  useEffect(() => {
    if (!serverPaging) return;
    if (filterKeyRef.current === filterKey) return;
    filterKeyRef.current = filterKey;
    setPage(1);
  }, [serverPaging, filterKey]);
  useEffect(() => {
    if (!serverPaging) return undefined;
    if (!companyId) { setLoading(false); return undefined; }
    const gen = ++serverGen.current;
    const ctrl = new AbortController();
    let alive = true;
    let snapped = false;
    setLoading(true);
    const params = {
      company_id: companyId,
      page,
      page_size: pageSize,
      type: filterType,
      status: statusFilter,
      fin: finFilter,
      sort,
    };
    if (searchTerm) params.q = searchTerm;
    axios.get(`${API_URL}/contacts`, { params, signal: ctrl.signal })
      .then(({ data }) => {
        if (!alive || gen !== serverGen.current) return;
        const total = Number(data?.total) || 0;
        const limit = contactTotalPages(total, pageSize);
        setServerTotal(total);
        setSummary(data?.summary || null);
        if (page > limit) {
          snapped = true;
          setPage((p) => Math.min(limit, Math.max(1, p)));
          return;
        }
        const items = Array.isArray(data?.items) ? data.items : [];
        setContacts(items);
        const nextFlags = {};
        for (const row of items) nextFlags[row.id] = row.flags || {};
        setFlags(nextFlags);
      })
      .catch((err) => {
        if (!alive || gen !== serverGen.current) return;
        const canceled = err?.code === "ERR_CANCELED" || err?.name === "CanceledError" || axios.isCancel?.(err);
        if (!canceled) toast.error("Cari listesi yüklenemedi.");
      })
      .finally(() => {
        if (!snapped && alive && gen === serverGen.current) setLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [serverPaging, companyId, page, pageSize, filterType, statusFilter, finFilter, sort, searchTerm, reloadTick]);
  const refreshContactsSilent = useCallback(() => {
    if (serverPaging) {
      setReloadTick((n) => n + 1);
      return;
    }
    loadContacts({ silent: true });
  }, [loadContacts, serverPaging]);
  useDataRefresh(refreshContactsSilent, { companyId, scopes: ["cash", "contacts", "invoices"] });
  const loadExportRows = useCallback(async () => {
    const params = {
      company_id: companyId,
      page: 1,
      page_size: pageSize,
      type: filterType,
      status: statusFilter,
      fin: finFilter,
      sort,
      export: 1,
    };
    if (searchTerm) params.q = searchTerm;
    const { data } = await axios.get(`${API_URL}/contacts`, { params });
    return Array.isArray(data?.items) ? data.items : [];
  }, [companyId, pageSize, filterType, statusFilter, finFilter, sort, searchTerm]);


  const clearContactSearch = useCallback(() => {
    setSearchTerm("");
    if (!searchParams.get("search") && !searchParams.get("q")) return;
    setSearchParams((prev) => withoutContactSearchParams(prev), { replace: true });
  }, [searchParams, setSearchParams]);
  const openContact = useCallback((contact) => {
    setSearchTerm("");
    setSearchParams({ contact_id: contact.id || contact._id });
  }, [setSearchParams]);

  const openStatement = async (contact) => {
    clearContactSearch();
    setSelectedContactStatement(contact);
    try {
      const res = await axios.get(`${API_URL}/contacts/${contact.id || contact._id}/statement`);
      setStatementData(res.data);
    } catch (err) {
      toast.error("Ekstre yüklenemedi.");
    }
  };

  const finMatch = (c) => { const f = flags[c.id] || {}; switch (finFilter) { case "debtors": return (c.balance || 0) > 0; case "creditors": return (c.balance || 0) < 0; case "overdue": return f.overdue_count > 0 || f.installment_overdue_count > 0; case "installments": return f.installment_due_count > 0; case "clear": return !(c.balance || 0); default: return true; } };
  const clientCounts = {
    all: contacts.length,
    debtors: contacts.filter((c) => (c.balance || 0) > 0).length,
    creditors: contacts.filter((c) => (c.balance || 0) < 0).length,
    overdue: contacts.filter((c) => (flags[c.id]?.overdue_count || 0) > 0 || (flags[c.id]?.installment_overdue_count || 0) > 0).length,
    installments: contacts.filter((c) => (flags[c.id]?.installment_due_count || 0) > 0).length,
    clear: contacts.filter((c) => !(c.balance || 0)).length,
  };
  const counts = serverPaging && summary ? {
    all: summary.facet_total ?? 0,
    debtors: summary.debtors ?? 0,
    creditors: summary.creditors ?? 0,
    overdue: summary.overdue ?? 0,
    installments: summary.installments ?? 0,
    clear: summary.clear ?? 0,
  } : clientCounts;
  const FIN_FILTERS = [["all", "Tümü", counts.all], ["debtors", "Bize Borçlu (Alacağımız var)", counts.debtors], ["creditors", "Bize Alacaklı (Borcumuz var)", counts.creditors], ["overdue", "Vadesi Geçenler", counts.overdue], ["installments", "Taksit Ödemesi Gelenler (7 gün)", counts.installments], ["clear", "Bakiyesi Sıfır", counts.clear]];
  const statusMatch = (c) => {
    if (statusFilter === "active") return c.is_active !== false;
    if (statusFilter === "inactive") return c.is_active === false;
    return true;
  };
  const filtered = serverPaging ? contacts : contacts.filter((c) => finMatch(c)).filter(statusMatch).filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.company_title && c.company_title.toLowerCase().includes(searchTerm.toLowerCase())) ||
    c.tax_number_or_id.includes(searchTerm)
  );
  const { visible: pagedContacts, hasMore: contactsHasMore, sentinelRef: contactsSentinelRef } = useInfiniteRows(serverPaging ? EMPTY_CONTACT_ROWS : filtered, {
    resetKey: `${filterType}|${finFilter}|${statusFilter}|${searchTerm}`,
  });
  const visibleContacts = serverPaging ? contacts : pagedContacts;
  const totalPages = contactTotalPages(serverTotal, pageSize);

  return (
    <div className="space-y-6" data-testid="contacts-page">
      {!companyId && <NoCompanyNotice />}
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
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 pb-3">
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
          <span className="w-px h-5 bg-slate-200 mx-1" aria-hidden="true" />
          {[
            { id: "all", label: "Aktif+Pasif" },
            { id: "active", label: "Aktif" },
            { id: "inactive", label: "Pasif" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStatusFilter(t.id)}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                statusFilter === t.id ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
              data-testid={`contact-status-filter-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <ExportButtons rows={filtered} columns={CONTACT_COLS} filename="cariler" title="Cari Listesi" loadRows={serverPaging ? loadExportRows : undefined} />
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
          {serverPaging && (
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white font-medium text-slate-700"
              data-testid="contacts-sort"
            >
              <option value="name">Ünvan (A-Z)</option>
              <option value="name_desc">Ünvan (Z-A)</option>
              <option value="balance_desc">Bakiye (yüksek)</option>
              <option value="balance_asc">Bakiye (düşük)</option>
            </select>
          )}
        </div>

        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Cari adı, unvan veya VKN ile ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-xl text-xs w-full min-w-[240px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
            data-testid="contact-search-input"
          />
        </div>
      </div>

      {/* Contacts List (horizontal rows) */}
      <div className="space-y-2" data-testid="contacts-list">
        {filtered.length === 0 && !(serverPaging && loading) && <div className="bg-white rounded-xl border p-8 text-center text-sm text-slate-400" data-testid="contacts-empty">Filtreye uyan cari yok.</div>}
        {visibleContacts.map((contact) => (
          <ContactRow key={contact.id || contact._id} contact={contact} flag={flags[contact.id]} onOpen={() => openContact(contact)} onEdit={() => { clearContactSearch(); setEditContact(contact); }} onMessage={() => { clearContactSearch(); setMessageContact(contact); }} onStatement={() => openStatement(contact)} onLocation={() => setLocationContact(contact)} />
        ))}
        {serverPaging && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1" data-testid="contacts-pager">
            <div data-testid="contacts-result-summary" className="text-slate-500">
              <b className="text-slate-900">{serverTotal}</b> cari · Alacak <b className="text-emerald-700">{fmtMoney(summary?.receivable_total || 0)}</b> · Borç <b className="text-rose-700">{fmtMoney(summary?.payable_total || 0)}</b>
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-slate-600">
                <span className="font-semibold text-slate-500">Sayfa</span>
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white" data-testid="contacts-page-size">
                  {CONTACT_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button type="button" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.min(totalPages, Math.max(1, p - 1)))} className="px-2.5 py-1.5 rounded-lg border border-slate-200 font-semibold disabled:opacity-40" data-testid="contacts-page-prev">Önceki</button>
              <span data-testid="contacts-page-indicator" className="font-semibold text-slate-700">{page} / {totalPages}</span>
              <button type="button" disabled={loading || page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, Math.max(1, p + 1)))} className="px-2.5 py-1.5 rounded-lg border border-slate-200 font-semibold disabled:opacity-40" data-testid="contacts-page-next">Sonraki</button>
            </div>
          </div>
        )}
        {!serverPaging && contactsHasMore && (
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

      {(showAddModal || editContact) && <ContactForm companyId={activeCompanyId(activeCompany)} contact={editContact} onClose={() => { setShowAddModal(false); setEditContact(null); }} onSaved={(saved) => { setShowAddModal(false); setEditContact(null); if (saved?.deleted && detailContactId) setSearchParams({}); if (serverPaging) setReloadTick((n) => n + 1); else loadContacts(); }} />}

      {/* CARİ EKSTRESİ MODAL */}
      {selectedContactStatement && statementData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-[min(1680px,calc(100vw-2rem))] w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto overflow-x-hidden min-w-0" data-testid="statement-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <div>
                <h3 className="text-base font-bold text-slate-900">{selectedContactStatement.name} - Cari Ekstresi</h3>
                <p className="text-xs text-slate-500">VKN: {selectedContactStatement.tax_number_or_id} • Bakiye: {fmtMoney(selectedContactStatement.balance, selectedContactStatement.currency || "TRY")}</p>
              </div>
              <button onClick={() => setSelectedContactStatement(null)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>

            <StatementViewProvider>
              <StatementShareBar contact={selectedContactStatement} rows={statementRows} companyId={activeCompanyId(activeCompany)} />

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between"><h4 className="font-bold text-slate-800">Hesap Hareketleri (Fatura & Ödeme)</h4><div className="flex items-center gap-2 text-[10px] font-semibold"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" /> Fatura (Borç)</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Tahsilat / Ödeme</span></div></div>
                <StatementTxList
                  rows={statementRows}
                  currency={selectedContactStatement.currency || "TRY"}
                  tableTestId="statement-table"
                  rowTestId={(r, idx) => `statement-row-${r.kind}-${idx}`}
                  showKindDot
                  emptyAmount="-"
                  cellPad="py-2 px-3"
                />
              </div>
            </StatementViewProvider>

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
