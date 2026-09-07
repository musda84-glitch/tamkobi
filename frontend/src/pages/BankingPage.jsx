import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  Landmark,
  Wallet,
  CreditCard,
  ArrowRightLeft,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  X,
  History,
  CheckCircle2,
  Users,
  Link2,
  Pencil,
  Trash2
} from "lucide-react";
import { PartnersPanel } from "../components/PartnersPanel";
import { BankConnectionsPanel } from "../components/BankConnectionsPanel";
import { CardStatementImport } from "../components/CardStatementImport";
import { CashApprovalsBanner } from "../components/CashApprovalsBanner";

const TABS = [
  { key: "accounts", label: "Hesaplar & Hareketler", icon: Landmark },
  { key: "partners", label: "Ortaklar Hesabı", icon: Users },
  { key: "connections", label: "Banka Entegrasyonu (Canlı Veri)", icon: Link2 }
];

const money = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

const ACCOUNT_GROUPS = [
  { type: "bank", badge: "Banka Hesapları", unit: "Hesap", icon: Landmark, card: "bg-blue-50/60 border-blue-200", iconBox: "bg-blue-100 text-blue-700", badgeCls: "text-blue-700 bg-blue-100", border: "border-blue-200/60" },
  { type: "cash_box", badge: "Kasalar", unit: "Kasa", icon: Wallet, card: "bg-emerald-50/60 border-emerald-200", iconBox: "bg-emerald-100 text-emerald-700", badgeCls: "text-emerald-700 bg-emerald-100", border: "border-emerald-200/60" },
  { type: "pos", badge: "POS Hesapları", unit: "POS", icon: CreditCard, card: "bg-purple-50/60 border-purple-200", iconBox: "bg-purple-100 text-purple-700", badgeCls: "text-purple-700 bg-purple-100", border: "border-purple-200/60" },
  { type: "credit_card", badge: "Kredi Kartları", unit: "Kart", icon: CreditCard, card: "bg-fuchsia-50/60 border-fuchsia-200", iconBox: "bg-fuchsia-100 text-fuchsia-700", badgeCls: "text-fuchsia-700 bg-fuchsia-100", border: "border-fuchsia-200/60" }
];

const emptyAccountForm = {
  type: "bank",
  bank_name: "",
  account_name: "",
  account_number: "",
  iban: "",
  currency: "TRY",
  current_balance: 0.0,
  pos_commission_rate: 1.5
};

export default function BankingPage() {
  const { activeCompany } = useAuth();
  const [searchParams] = useSearchParams();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [tab, setTab] = useState(searchParams.get("tab") || "accounts");
  const [contacts, setContacts] = useState([]);
  const [partnerSummary, setPartnerSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [stmtAccount, setStmtAccount] = useState(null);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [showVirmanModal, setShowVirmanModal] = useState(searchParams.get("action") === "virman");
  const [cashTick, setCashTick] = useState(0);

  // New Account Form
  const [newAccount, setNewAccount] = useState(emptyAccountForm);

  // Virman Form
  const [virmanForm, setVirmanForm] = useState({
    source_account_id: "",
    target_account_id: "",
    amount: "",
    description: "Hesaplar arası transfer (Virman)"
  });

  const loadBankingData = useCallback(async () => {
    try {
      setLoading(true);
      const [accRes, txRes, cRes, psRes] = await Promise.all([
        axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/transactions?company_id=${companyId}`),
        axios.get(`${API_URL}/contacts?company_id=${companyId}`).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/banking/partners/summary?company_id=${companyId}`).catch(() => ({ data: null }))
      ]);
      setAccounts(accRes.data);
      setTransactions(txRes.data);
      setContacts(cRes.data);
      setPartnerSummary(psRes.data);
      const manual = accRes.data.filter((a) => !a.is_integrated);
      if (manual.length >= 2) {
        setVirmanForm(prev => ({
          ...prev,
          source_account_id: manual[0].id || manual[0]._id,
          target_account_id: manual[1].id || manual[1]._id
        }));
      }
    } catch (err) {
      toast.error("Banka verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);
  useEffect(() => { loadBankingData(); }, [loadBankingData]);

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    try {
      const company_id = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
      const payload = { ...newAccount, current_balance: Number(newAccount.current_balance || 0) };
      if (editingAccount) {
        const { current_balance: _bal, ...meta } = payload;
        await axios.put(`${API_URL}/banking/accounts/${editingAccount.id || editingAccount._id}`, meta);
        toast.success("Hesap güncellendi.");
      } else {
        await axios.post(`${API_URL}/banking/accounts`, { company_id, ...payload });
        toast.success("Banka/Kasa hesabı başarıyla eklendi.");
      }
      setShowAddAccountModal(false);
      setEditingAccount(null);
      setNewAccount(emptyAccountForm);
      loadBankingData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Hesap kaydedilemedi.");
    }
  };

  const openEditAccount = (acc, e) => {
    e?.stopPropagation();
    setEditingAccount(acc);
    setNewAccount({
      type: acc.type || "bank",
      bank_name: acc.bank_name || "",
      account_name: acc.account_name || "",
      account_number: acc.account_number || "",
      iban: acc.iban || "",
      currency: acc.currency || "TRY",
      current_balance: acc.current_balance || 0,
      pos_commission_rate: acc.pos_commission_rate || 1.5
    });
    setShowAddAccountModal(true);
  };

  const handleDeleteAccount = async (acc, e) => {
    e?.stopPropagation();
    const name = `${acc.bank_name || ""} — ${acc.account_name || ""}`.trim();
    if (!window.confirm(`"${name}" silinsin mi? Hareketi olan hesaplar silinemez.`)) return;
    try {
      const r = await axios.delete(`${API_URL}/banking/accounts/${acc.id || acc._id}`);
      toast.success(r.data.message || "Hesap silindi.");
      if (selectedAccountId === (acc.id || acc._id)) setSelectedAccountId(null);
      loadBankingData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Hesap silinemedi.");
    }
  };

  const handleExecuteVirman = async (e) => {
    e.preventDefault();
    if (!virmanForm.amount || Number(virmanForm.amount) <= 0) {
      toast.error("Geçerli bir tutar giriniz.");
      return;
    }
    if (virmanForm.source_account_id === virmanForm.target_account_id) {
      toast.error("Kaynak ve hedef hesap aynı olamaz.");
      return;
    }
    try {
      const res = await axios.post(`${API_URL}/banking/virman`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        source_account_id: virmanForm.source_account_id,
        target_account_id: virmanForm.target_account_id,
        amount: Number(virmanForm.amount),
        description: virmanForm.description
      });
      toast.success(res.data.message);
      setShowVirmanModal(false);
      setVirmanForm({ ...virmanForm, amount: "" });
      setCashTick((n) => n + 1);
      loadBankingData();
    } catch (err) {
      toast.error("Virman işlemi gerçekleştirilemedi.");
    }
  };

  const totalLiquidity = accounts.reduce((sum, a) => sum + (a.current_balance || 0), 0);
  const selectedAccount = accounts.find(a => (a.id || a._id) === selectedAccountId);
  const grouped = ACCOUNT_GROUPS.map((g) => {
    const items = accounts.filter((a) => a.type === g.type);
    return { ...g, items, total: items.reduce((s, a) => s + (a.current_balance || 0), 0) };
  }).filter((g) => g.items.length > 0);
  const openGroup = grouped.find((g) => g.type === selectedGroup) || null;
  const groupIds = openGroup ? openGroup.items.map((a) => a.id || a._id) : null;
  const visibleTx = selectedAccountId
    ? transactions.filter(tx => tx.account_id === selectedAccountId || tx.target_account_id === selectedAccountId)
    : groupIds
      ? transactions.filter(tx => groupIds.includes(tx.account_id) || groupIds.includes(tx.target_account_id))
      : transactions;
  const txInflow = visibleTx.filter(tx => tx.type === 'inflow' || (tx.type === 'transfer' && tx.target_account_id === selectedAccountId)).reduce((s, tx) => s + (tx.amount || 0), 0);
  const txOutflow = visibleTx.filter(tx => tx.type === 'outflow' || (tx.type === 'transfer' && tx.account_id === selectedAccountId)).reduce((s, tx) => s + (tx.amount || 0), 0);

  return (
    <div className="space-y-6" data-testid="banking-page">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Banka, Kasa & POS Yönetimi</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Toplam Likidite: <span className="font-bold text-emerald-600">{totalLiquidity.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowVirmanModal(true)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-indigo-600/20 transition"
            data-testid="virman-modal-btn"
          >
            <ArrowRightLeft className="w-4 h-4" />
            <span>Virman Yap</span>
          </button>
          <button
            onClick={() => { setEditingAccount(null); setNewAccount(emptyAccountForm); setShowAddAccountModal(true); }}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-600/20 transition"
            data-testid="add-bank-account-btn"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Hesap</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition ${tab === key ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`} data-testid={`banking-tab-${key}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "partners" && <PartnersPanel companyId={companyId} accounts={accounts} onCashChanged={loadBankingData} />}
      {tab === "connections" && <BankConnectionsPanel companyId={companyId} accounts={accounts} contacts={contacts} onSynced={loadBankingData} />}

      {tab === "accounts" && (<>
      <CashApprovalsBanner companyId={companyId} refreshKey={cashTick} onChanged={() => { setCashTick((n) => n + 1); loadBankingData(); }} />
      {/* Grouped account cards — same pattern as Ortaklar Hesabı */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="account-groups-grid">
        {partnerSummary && partnerSummary.partner_count > 0 && (
          <button onClick={() => setTab("partners")} className="bg-amber-50/60 p-5 rounded-2xl border border-amber-200 shadow-sm space-y-3 hover:shadow-md transition flex flex-col justify-between text-left" data-testid="partners-account-card">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="p-2 rounded-xl bg-amber-100 text-amber-700"><Users className="w-5 h-5" /></div>
                <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">Ortaklar Hesabı</span>
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{partnerSummary.partner_count} Ortak</h3>
                <div className="text-xs text-slate-500">Sermaye: {partnerSummary.total_capital_in.toLocaleString('tr-TR')} ₺ • Çekilen: {partnerSummary.total_withdrawn.toLocaleString('tr-TR')} ₺</div>
              </div>
            </div>
            <div className="pt-3 border-t border-amber-200/60">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Ortak Alacağı (Bakiye)</div>
              <div className="text-xl font-bold text-slate-900 tracking-tight">{partnerSummary.total_balance.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</div>
            </div>
          </button>
        )}
        {grouped.map((g) => {
          const Icon = g.icon;
          const isOpen = selectedGroup === g.type;
          return (
            <button
              key={g.type}
              type="button"
              onClick={() => { setSelectedGroup(isOpen ? null : g.type); setSelectedAccountId(null); }}
              className={`${g.card} p-5 rounded-2xl border shadow-sm space-y-3 hover:shadow-md transition flex flex-col justify-between text-left ${isOpen ? "ring-2 ring-emerald-500/30 shadow-md" : ""}`}
              data-testid={`account-group-${g.type}`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className={`p-2 rounded-xl ${g.iconBox}`}><Icon className="w-5 h-5" /></div>
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${g.badgeCls}`}>{g.badge}</span>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{g.items.length} {g.unit}</h3>
                  <div className="text-xs text-slate-500 truncate">{g.items.map((a) => a.bank_name).filter(Boolean).slice(0, 3).join(" · ") || "—"}</div>
                </div>
              </div>
              <div className={`pt-3 border-t ${g.border} flex items-end justify-between gap-2`}>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">Toplam Bakiye</div>
                  <div className="text-xl font-bold text-slate-900 tracking-tight">{money(g.total)} ₺</div>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isOpen ? "bg-emerald-600 text-white" : "bg-white/80 text-slate-500"}`}>{isOpen ? "Hesaplar ↓" : "Hesapları Gör"}</span>
              </div>
            </button>
          );
        })}
      </div>

      {openGroup && (
        <div className="space-y-3" data-testid={`account-group-members-${openGroup.type}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">{openGroup.badge}</h2>
            <button type="button" onClick={() => { setSelectedGroup(null); setSelectedAccountId(null); }} className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-full" data-testid="clear-group-btn"><X className="w-3 h-3 inline" /> Kapat</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {openGroup.items.map((acc) => {
              const accId = acc.id || acc._id;
              const isSelected = selectedAccountId === accId;
              const isCard = acc.type === "credit_card";
              return (
                <div
                  key={accId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedAccountId(isSelected ? null : accId)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedAccountId(isSelected ? null : accId); } }}
                  className={`bg-white p-4 rounded-2xl border shadow-sm space-y-3 hover:shadow-md transition flex flex-col justify-between text-left ${isSelected ? "border-emerald-500 ring-2 ring-emerald-500/30 shadow-md" : "border-slate-200/90"}`}
                  data-testid={`bank-card-${accId}`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm">{acc.bank_name}</h3>
                        <div className="text-xs text-slate-500 truncate">{acc.account_name}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={(e) => openEditAccount(acc, e)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100" title="Düzelt" data-testid={`edit-account-${accId}`}><Pencil className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={(e) => handleDeleteAccount(acc, e)} disabled={acc.is_integrated} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30" title={acc.is_integrated ? "Entegre hesap silinemez" : "Sil"} data-testid={`delete-account-${accId}`}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    {acc.is_integrated && <div className="flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-0.5 w-fit" data-testid={`integrated-badge-${accId}`}><Link2 className="w-3 h-3" /> ENTEGRE · {acc.integration_provider}</div>}
                    {isCard && <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[10px] text-slate-400">{acc.card_limit ? `Limit ${Number(acc.card_limit).toLocaleString("tr-TR")} ₺` : "Limit —"}{acc.last_statement?.due_date ? ` · Son ödeme ${acc.last_statement.due_date}` : ""}</span><button onClick={(e) => { e.stopPropagation(); setStmtAccount({ ...acc, id: accId }); }} className="text-[10px] font-semibold text-fuchsia-700 bg-fuchsia-50 hover:bg-fuchsia-100 px-2 py-0.5 rounded-md" data-testid={`card-stmt-btn-${accId}`}>Ekstre Aktar (AI)</button></div>}
                    {acc.iban && acc.iban !== "-" && <div className="text-[11px] font-mono text-slate-400 truncate">{acc.iban}</div>}
                  </div>
                  <div className="pt-3 border-t border-slate-100 flex items-end justify-between gap-2">
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Mevcut Bakiye</div>
                      <div className="text-lg font-bold text-slate-900 tracking-tight">{money(acc.current_balance)} ₺</div>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isSelected ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>{isSelected ? "Hareketler ↓" : "Hareketleri Gör"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Transactions History */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden space-y-3 p-5" data-testid="transactions-panel">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" />
            <h2 className="text-base font-bold text-slate-900" data-testid="transactions-title">{selectedAccount ? `${selectedAccount.bank_name} — ${selectedAccount.account_name} Hareketleri` : openGroup ? `${openGroup.badge} Hareketleri` : "Son Finansal Hareketler"}</h2>
            {(selectedAccount || openGroup) && (
              <button onClick={() => { setSelectedAccountId(null); if (selectedAccount) return; setSelectedGroup(null); }} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-full transition" data-testid="clear-account-filter-btn"><X className="w-3 h-3" /> {selectedAccount ? "Grup Hareketleri" : "Tüm Hesaplar"}</button>
            )}
          </div>
          {selectedAccount || openGroup ? (
            <div className="flex items-center gap-3 text-[11px]" data-testid="account-tx-summary">
              <span className="text-slate-500">{visibleTx.length} hareket</span>
              <span className="font-semibold text-emerald-600">Giren +{txInflow.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
              <span className="font-semibold text-rose-600">Çıkan -{txOutflow.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</span>
            </div>
          ) : (
            <span className="text-xs text-slate-400">Tahsilat, Tediye ve Virman İşlemleri • Gruba veya hesaba tıklayınca filtrelenir</span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-4 py-2.5">Tarih</th>
                <th className="px-4 py-2.5">Hesap / Kasa</th>
                <th className="px-4 py-2.5">İşlem Türü & Kategori</th>
                <th className="px-4 py-2.5">Açıklama / Cari</th>
                <th className="px-4 py-2.5 text-right">Tutar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleTx.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">{selectedAccount ? 'Bu hesaba ait hareket bulunmuyor.' : 'Henüz finansal hareket kaydı bulunmuyor.'}</td>
                </tr>
              ) : (
                visibleTx.map((tx) => (
                  <tr key={tx.id || tx._id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-2.5 text-slate-500 font-mono">{tx.date}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{tx.account_name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                        tx.type === 'inflow' ? 'bg-emerald-50 text-emerald-700' : tx.type === 'outflow' ? 'bg-rose-50 text-rose-700' : 'bg-indigo-50 text-indigo-700'
                      }`}>
                        {tx.type === 'inflow' ? <ArrowDownRight className="w-3 h-3" /> : tx.type === 'outflow' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowRightLeft className="w-3 h-3" />}
                        {tx.category || tx.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{tx.description} {tx.source === 'bank_sync' && <span className={`ml-1 text-[9px] px-1 rounded font-bold ${tx.is_simulated ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{tx.is_simulated ? 'SİMÜLE' : 'BANKA'}</span>}{tx.source === 'bank_sync' && tx.match_status === 'matched' && <span className="ml-1 text-[9px] px-1 rounded font-bold bg-emerald-100 text-emerald-700" data-testid={`tx-matched-${tx.id}`}>EŞLEŞTİ{tx.contact_name ? `: ${tx.contact_name}` : tx.target_account_name ? ` → ${tx.target_account_name}` : ''}</span>}{tx.source === 'bank_sync' && tx.match_status === 'unmatched' && <span className="ml-1 text-[9px] px-1 rounded font-bold bg-slate-100 text-slate-500">EŞLEŞME BEKLİYOR</span>}{tx.source === 'bank_match' && <span className="ml-1 text-[9px] px-1 rounded font-bold bg-indigo-100 text-indigo-700">BANKA VİRMANI</span>}</td>
                    <td className={`px-4 py-2.5 text-right font-bold ${
                      tx.type === 'inflow' ? 'text-emerald-600' : tx.type === 'outflow' ? 'text-rose-600' : 'text-indigo-600'
                    }`}>
                      {tx.type === 'inflow' ? `+${tx.amount?.toLocaleString('tr-TR')} ₺` : tx.type === 'outflow' ? `-${tx.amount?.toLocaleString('tr-TR')} ₺` : `${tx.amount?.toLocaleString('tr-TR')} ₺`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>)}

      {/* VIRMAN MODAL */}
      {showVirmanModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="virman-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Hesaplar Arası Virman (Para Transferi)</h3>
              <button onClick={() => setShowVirmanModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleExecuteVirman} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Kaynak Hesap (Çıkış)</label>
                <select
                  value={virmanForm.source_account_id}
                  onChange={(e) => setVirmanForm({ ...virmanForm, source_account_id: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="virman-source-select"
                >
                  {accounts.filter(a => !a.is_integrated).map(a => (
                    <option key={a.id || a._id} value={a.id || a._id}>
                      {a.bank_name} - {a.account_name} ({a.current_balance?.toLocaleString('tr-TR')} ₺)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hedef Hesap (Giriş)</label>
                <select
                  value={virmanForm.target_account_id}
                  onChange={(e) => setVirmanForm({ ...virmanForm, target_account_id: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="virman-target-select"
                >
                  {accounts.filter(a => !a.is_integrated).map(a => (
                    <option key={a.id || a._id} value={a.id || a._id}>
                      {a.bank_name} - {a.account_name} ({a.current_balance?.toLocaleString('tr-TR')} ₺)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Transfer Tutarı (₺)</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={virmanForm.amount}
                  onChange={(e) => setVirmanForm({ ...virmanForm, amount: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-bold text-slate-900 text-sm"
                  data-testid="virman-amount-input"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Açıklama</label>
                <input
                  type="text"
                  value={virmanForm.description}
                  onChange={(e) => setVirmanForm({ ...virmanForm, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowVirmanModal(false)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="submit-virman-btn"
                >
                  Virmanı Onayla & Aktar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD ACCOUNT MODAL */}
      {showAddAccountModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid="add-account-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">{editingAccount ? "Hesabı Düzelt" : "Yeni Banka / Kasa / POS Hesabı"}</h3>
              <button onClick={() => { setShowAddAccountModal(false); setEditingAccount(null); }} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveAccount} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hesap Türü</label>
                <select
                  value={newAccount.type}
                  onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="account-type-select"
                >
                  <option value="bank">Banka Vadesiz Ticari</option>
                  <option value="cash_box">Nakit Kasa</option>
                  <option value="pos">POS Cihazı / Sanal POS</option>
                  <option value="credit_card">Kredi Kartı (Şirket Kartı)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Banka / Kurum Adı</label>
                <input
                  type="text"
                  placeholder="Örn: Garanti BBVA, Yapı Kredi, Merkez Kasa"
                  value={newAccount.bank_name}
                  onChange={(e) => setNewAccount({ ...newAccount, bank_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="bank-name-input"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hesap Adı</label>
                <input
                  type="text"
                  placeholder="Örn: Ana Ticari TL Hesabı"
                  value={newAccount.account_name}
                  onChange={(e) => setNewAccount({ ...newAccount, account_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  data-testid="account-name-input"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">IBAN No</label>
                <input
                  type="text"
                  placeholder="TR..."
                  value={newAccount.iban}
                  onChange={(e) => setNewAccount({ ...newAccount, iban: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Açılış Bakiyesi (₺)</label>
                <input
                  type="number"
                  value={newAccount.current_balance}
                  onChange={(e) => setNewAccount({ ...newAccount, current_balance: e.target.value })}
                  disabled={!!editingAccount}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 disabled:text-slate-400"
                />
                {editingAccount && <p className="text-[10px] text-slate-400 mt-1">Bakiye hareketlerle değişir; düzeltmede değiştirilmez.</p>}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => { setShowAddAccountModal(false); setEditingAccount(null); }}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-account-btn"
                >
                  {editingAccount ? "Değişiklikleri Kaydet" : "Hesabı Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {stmtAccount && <CardStatementImport account={stmtAccount} onClose={() => setStmtAccount(null)} onDone={loadBankingData} />}
    </div>
  );
}
