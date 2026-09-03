import React, { useState, useEffect } from "react";
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
  Link2
} from "lucide-react";
import { PartnersPanel } from "../components/PartnersPanel";
import { BankConnectionsPanel } from "../components/BankConnectionsPanel";

const TABS = [
  { key: "accounts", label: "Hesaplar & Hareketler", icon: Landmark },
  { key: "partners", label: "Ortaklar Hesabı", icon: Users },
  { key: "connections", label: "Banka Entegrasyonu (Canlı Veri)", icon: Link2 }
];

export default function BankingPage() {
  const { activeCompany } = useAuth();
  const [searchParams] = useSearchParams();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [tab, setTab] = useState(searchParams.get("tab") || "accounts");
  const [contacts, setContacts] = useState([]);
  const [partnerSummary, setPartnerSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showVirmanModal, setShowVirmanModal] = useState(searchParams.get("action") === "virman");

  // New Account Form
  const [newAccount, setNewAccount] = useState({
    type: "bank",
    bank_name: "Garanti BBVA",
    account_name: "Vadesiz TL Hesabı",
    account_number: "",
    iban: "",
    currency: "TRY",
    current_balance: 0.0,
    pos_commission_rate: 1.5
  });

  // Virman Form
  const [virmanForm, setVirmanForm] = useState({
    source_account_id: "",
    target_account_id: "",
    amount: "",
    description: "Hesaplar arası transfer (Virman)"
  });

  useEffect(() => {
    loadBankingData();
  }, [activeCompany]);

  const loadBankingData = async () => {
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
      if (accRes.data.length >= 2) {
        setVirmanForm(prev => ({
          ...prev,
          source_account_id: accRes.data[0].id || accRes.data[0]._id,
          target_account_id: accRes.data[1].id || accRes.data[1]._id
        }));
      }
    } catch (err) {
      toast.error("Banka verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/banking/accounts`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        ...newAccount,
        current_balance: Number(newAccount.current_balance || 0)
      });
      toast.success("Banka/Kasa hesabı başarıyla eklendi.");
      setShowAddAccountModal(false);
      loadBankingData();
    } catch (err) {
      toast.error("Hesap kaydedilemedi.");
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
      loadBankingData();
    } catch (err) {
      toast.error("Virman işlemi gerçekleştirilemedi.");
    }
  };

  const totalLiquidity = accounts.reduce((sum, a) => sum + (a.current_balance || 0), 0);

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
            onClick={() => setShowAddAccountModal(true)}
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
      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
        {accounts.map((acc) => {
          const isBank = acc.type === 'bank';
          const isCash = acc.type === 'cash_box';
          const isPos = acc.type === 'pos';

          return (
            <div
              key={acc.id || acc._id}
              className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm space-y-3 hover:shadow-md transition flex flex-col justify-between"
              data-testid={`bank-card-${acc.account_name}`}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className={`p-2 rounded-xl ${
                    isBank ? 'bg-blue-50 text-blue-600' : isCash ? 'bg-emerald-50 text-emerald-600' : 'bg-purple-50 text-purple-600'
                  }`}>
                    {isBank ? <Landmark className="w-5 h-5" /> : isCash ? <Wallet className="w-5 h-5" /> : <CreditCard className="w-5 h-5" />}
                  </div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                    {isBank ? 'Banka Hesabı' : isCash ? 'Kasa' : 'Sanal/Fiziki POS'}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{acc.bank_name}</h3>
                  <div className="text-xs text-slate-500 truncate">{acc.account_name}</div>
                  {acc.iban && acc.iban !== '-' && (
                    <div className="text-[11px] font-mono text-slate-400 mt-1 truncate">{acc.iban}</div>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <div className="text-[10px] text-slate-400 uppercase font-semibold">Mevcut Bakiye</div>
                <div className="text-xl font-bold text-slate-900 tracking-tight">
                  {acc.current_balance?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Transactions History */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden space-y-3 p-5">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" />
            <h2 className="text-base font-bold text-slate-900">Son Finansal Hareketler</h2>
          </div>
          <span className="text-xs text-slate-400">Tahsilat, Tediye ve Virman İşlemleri</span>
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
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Henüz finansal hareket kaydı bulunmuyor.</td>
                </tr>
              ) : (
                transactions.map((tx) => (
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
                    <td className="px-4 py-2.5 text-slate-700">{tx.description} {tx.source === 'bank_sync' && <span className={`ml-1 text-[9px] px-1 rounded font-bold ${tx.is_simulated ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{tx.is_simulated ? 'SİMÜLE' : 'BANKA'}</span>}</td>
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
                  {accounts.map(a => (
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
                  {accounts.map(a => (
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
              <h3 className="text-base font-bold text-slate-900">Yeni Banka / Kasa / POS Hesabı</h3>
              <button onClick={() => setShowAddAccountModal(false)} className="text-slate-400">
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
                >
                  <option value="bank">Banka Vadesiz Ticari</option>
                  <option value="cash_box">Nakit Kasa</option>
                  <option value="pos">POS Cihazı / Sanal POS</option>
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
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddAccountModal(false)}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-account-btn"
                >
                  Hesabı Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
