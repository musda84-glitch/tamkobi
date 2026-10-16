import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { PartnersPanel } from "../components/PartnersPanel";
import { ReconciliationPanel } from "../components/ReconciliationPanel";
import { cachedList } from "../utils/dataSync";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";
import { BankConnectionsPanel } from "../components/BankConnectionsPanel";
import { CardStatementImport } from "../components/CardStatementImport";
import { asContactList, canUploadBankStatement } from "../utils/bankStatementUpload";
import { matchActorTitle, matchStatusLabel, txUserColumnLabel, txDescriptionLabel } from "../utils/bankMatchLabel";
import { filterAccountTransactions } from "../utils/bankAccountTx";
import { CashApprovalsBanner } from "../components/CashApprovalsBanner";
import { AccountStatementPrint } from "../components/AccountStatementPrint";
import { TxRowMenu } from "../components/TxRowMenu";
import { TxMobileCard, TxResponsiveList, TxTypeBadge, TX_WRAP_CLASS } from "../components/TxMobileCard";
import { SearchSelect } from "../components/SearchSelect";
import { VirmanPartySelect } from "../components/VirmanPartySelect";
import { MoneyInput } from "../components/MoneyInput";

import { formatTrAmount, fmtDate } from "../utils/money";
import { PARTNER_PAID_LABEL, PARTNER_RECEIVED_LABEL, partnerSummaryCardMeta } from "../utils/partnerTx";
import { shownAccountBalance, sumShownBalances, totalLiquidity as sumLiquidity } from "../utils/accountTotals";
import { accountDisplayLabel, accountTypeLabel } from "../utils/accountLabel";
import { useInfiniteRows } from "../hooks/useInfiniteRows";
import { isBankTxServerPagingEnabled } from "../utils/featureFlags";
import {
  Landmark,
  Wallet,
  CreditCard,
  Cpu,
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
  Trash2,
  Sparkles,
  Printer,
  Scale
} from "lucide-react";

const TABS = [
  { key: "accounts", label: "Hesaplar & Hareketler", icon: Landmark },
  { key: "partners", label: "Ortaklar Hesabı", icon: Users },
  { key: "reconciliation", label: "Mutabakat", icon: Scale },
  { key: "connections", label: "Banka Entegrasyonu (Canlı Veri)", icon: Link2 }
];

const money = (n) => formatTrAmount((n || 0));

const ACCOUNT_GROUPS = [
  { type: "bank", badge: "Banka Hesapları", unit: "Hesap", icon: Landmark, card: "bg-blue-50/60 border-blue-200", iconBox: "bg-blue-100 text-blue-700", badgeCls: "text-blue-700 bg-blue-100", border: "border-blue-200/60" },
  { type: "cash_box", badge: "Kasalar", unit: "Kasa", icon: Wallet, card: "bg-emerald-50/60 border-emerald-200", iconBox: "bg-emerald-100 text-emerald-700", badgeCls: "text-emerald-700 bg-emerald-100", border: "border-emerald-200/60" },
  { type: "pos", badge: "POS Hesapları", unit: "POS", icon: CreditCard, card: "bg-purple-50/60 border-purple-200", iconBox: "bg-purple-100 text-purple-700", badgeCls: "text-purple-700 bg-purple-100", border: "border-purple-200/60" },
  { type: "okc_pos", badge: "ÖKC POS Cihazları", unit: "ÖKC", icon: Cpu, card: "bg-teal-50/60 border-teal-200", iconBox: "bg-teal-100 text-teal-700", badgeCls: "text-teal-700 bg-teal-100", border: "border-teal-200/60" },
  { type: "credit_card", badge: "Kredi Kartları", unit: "Kart", icon: CreditCard, card: "bg-fuchsia-50/60 border-fuchsia-200", iconBox: "bg-fuchsia-100 text-fuchsia-700", badgeCls: "text-fuchsia-700 bg-fuchsia-100", border: "border-fuchsia-200/60" },
  { type: "customer_credit_card", badge: "Müşteri Kartları", unit: "Kart", icon: CreditCard, card: "bg-rose-50/60 border-rose-200", iconBox: "bg-rose-100 text-rose-700", badgeCls: "text-rose-700 bg-rose-100", border: "border-rose-200/60" }
];

const accountGroupType = (a) => (
  a?.type === "credit_card" && String(a?.card_owner || "company") === "customer"
    ? "customer_credit_card"
    : (a?.type || "bank")
);

const txAccountLabel = (tx, accounts) => {
  const byId = (id) => (accounts || []).find((a) => (a.id || a._id) === id);
  const one = (id, fallback) => {
    const acc = id ? byId(id) : null;
    if (acc) return accountDisplayLabel(acc);
    return fallback || "";
  };
  if (tx?.type === "transfer" && (tx.target_account_name || tx.target_account_id)) {
    const src = one(tx.account_id, tx.account_name) || "Hesap";
    const dst = one(tx.target_account_id, tx.target_account_name) || tx.target_account_name || "Hesap";
    return `${src} → ${dst}`;
  }
  return one(tx?.account_id, tx?.account_name) || "—";
};

const emptyAccountForm = {
  type: "bank",
  bank_name: "",
  account_name: "",
  account_number: "",
  iban: "",
  currency: "TRY",
  current_balance: 0.0,
  pos_commission_rate: 1.5,
  card_holder: "",
  card_last4: "",
  card_expiry: "",
  card_limit: "",
  card_owner: "company",
  linked_contact_id: "",
  okc_brand: "",
  okc_serial: "",
  okc_terminal_id: "",
  okc_api_url: "",
  okc_api_key: "",
};

/** Select value: müşteri kartı ayrı seçenek, kayıt type=credit_card + card_owner. */
const accountTypeSelectValue = (a) => (
  a?.type === "credit_card" && a?.card_owner === "customer" ? "customer_credit_card" : (a?.type || "bank")
);

function mergeMatchedTx(prev, matchedTx) {
  if (!matchedTx || !(matchedTx.id || matchedTx._id)) return prev;
  const mid = matchedTx.id || matchedTx._id;
  const rows = Array.isArray(prev) ? prev : [];
  let found = false;
  const next = rows.map((t) => {
    const id = t.id || t._id;
    if (id !== mid) return t;
    found = true;
    return { ...t, ...matchedTx, id: t.id || mid, match_status: matchedTx.match_status || "matched" };
  });
  return found ? next : [{ ...matchedTx, id: mid }, ...rows];
}

export default function BankingPage() {
  const { activeCompany, addonOn } = useAuth();
  const [searchParams] = useSearchParams();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const contactVirmanId = searchParams.get("contact_id") || "";
  const focusAccountId = searchParams.get("account_id") || "";
  const focusAccountName = searchParams.get("account") || "";
  const focusTx = searchParams.get("tx") || "";
  const focusPending = searchParams.get("pending") === "1";
  const missingTxToast = useRef(false);
  const [tab, setTab] = useState(searchParams.get("tab") === "match" ? "accounts" : (searchParams.get("tab") || "accounts"));
  const [contacts, setContacts] = useState([]);
  const [partnerSummary, setPartnerSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [stmtAccount, setStmtAccount] = useState(null);
  const [stmtFile, setStmtFile] = useState(null);
  const [printTx, setPrintTx] = useState(false);
  const [loading, setLoading] = useState(true);
  const [txReady, setTxReady] = useState(false);

  // Modals
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [showVirmanModal, setShowVirmanModal] = useState(searchParams.get("action") === "virman");
  const [cashTick, setCashTick] = useState(0);
  const [serverItems, setServerItems] = useState([]);
  const [serverHasMore, setServerHasMore] = useState(false);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverInflow, setServerInflow] = useState(0);
  const [serverOutflow, setServerOutflow] = useState(0);
  const [serverLoading, setServerLoading] = useState(false);
  const serverSentinelRef = useRef(null);
  const serverAbortRef = useRef(null);
  const serverGenRef = useRef(0);
  const pagingCtx = useRef({
    active: false,
    accountId: "",
    companyId: "",
    focusTx: "",
    focusPending: false,
    pages: [1],
    hasMore: false,
    loading: false,
  });
  const serverPaging = isBankTxServerPagingEnabled() && Boolean(selectedAccountId);
  pagingCtx.current.active = serverPaging;
  pagingCtx.current.accountId = selectedAccountId || "";
  pagingCtx.current.companyId = companyId;
  pagingCtx.current.focusTx = focusTx;
  pagingCtx.current.focusPending = focusPending;

  const emptyAccountForm = {
    type: "bank",
    bank_name: "Garanti BBVA",
    account_name: "Vadesiz TL Hesabı",
    account_number: "",
    iban: "",
    currency: "TRY",
    current_balance: 0.0,
    pos_commission_rate: 1.5,
    card_holder: "",
    card_last4: "",
    card_expiry: "",
    card_limit: "",
    card_owner: "company",
    linked_contact_id: "",
  };

  // New Account Form
  const [newAccount, setNewAccount] = useState(emptyAccountForm);

  // Virman Form
  const [virmanForm, setVirmanForm] = useState({
    source_account_id: "",
    target_account_id: "",
    amount: "",
    description: "Hesaplar arası transfer (Virman)",
    via_customer_card: false,
  });

  useEffect(() => {
    if (loading) return undefined;
    if (focusAccountId) {
      const acc = accounts.find((a) => (a.id || a._id) === focusAccountId);
      if (acc) setSelectedAccountId(focusAccountId);
      else if (!missingTxToast.current) {
        missingTxToast.current = true;
        toast.error("Kayıt bulunamadı");
      }
      return undefined;
    }
    if (focusAccountName) {
      const needle = focusAccountName.toLocaleLowerCase("tr-TR");
      const acc = accounts.find((a) => String(a.account_name || "").toLocaleLowerCase("tr-TR") === needle)
        || accounts.find((a) => String(a.account_name || "").toLocaleLowerCase("tr-TR").includes(needle));
      if (acc) setSelectedAccountId(acc.id || acc._id);
      else if (!missingTxToast.current) {
        missingTxToast.current = true;
        toast.error("Kayıt bulunamadı");
      }
    }
    return undefined;
  }, [loading, accounts, focusAccountId, focusAccountName]);

  useEffect(() => {
    if (loading || !txReady || !focusTx) return undefined;
    const tx = transactions.find((t) => (t.id || t._id) === focusTx);
    if (!tx) {
      if (!missingTxToast.current) {
        missingTxToast.current = true;
        toast.error("Kayıt bulunamadı");
      }
      return undefined;
    }
    if (tx.account_id) setSelectedAccountId(tx.account_id);
    return undefined;
  }, [loading, txReady, transactions, focusTx]);

  const silentReloadRef = useRef(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const driftKeyRef = useRef("");
  const loadBankingData = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      // Hareket ve cari listesi kartı bekletmez: önce önbellek, ağ arkada.
      const txPromise = cachedList("bank_transactions", companyId, { onCached: setTransactions })
        .then((rows) => {
          setTransactions(rows);
          return rows;
        })
        .catch(() => [])
        .finally(() => setTxReady(true));
      const contactsPromise = cachedList("contacts", companyId, { onCached: setContacts })
        .then((rows) => {
          setContacts(asContactList(rows));
          return rows;
        })
        .catch(() => []);
      const onReconciliation = tabRef.current === "reconciliation";
      const [accRes, psRes] = await Promise.all([
        onReconciliation
          ? Promise.resolve(null)
          : axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/partners/summary?company_id=${companyId}`).catch(() => ({ data: null }))
      ]);
      if (!accRes || tabRef.current === "reconciliation") {
        setPartnerSummary(psRes.data);
        if (!silent) setLoading(false);
        await Promise.all([txPromise, contactsPromise]);
        return;
      }
      setAccounts(accRes.data);
      setPartnerSummary(psRes.data);
      // Virman: entegre olmayan tüm hesaplar (kasa/banka/POS/kredi kartı). Cari URL'den gelirse kaynak olur.
      const manual = accRes.data.filter((a) => !a.is_integrated);
      if (contactVirmanId) {
        const firstAcc = manual[0] ? (manual[0].id || manual[0]._id) : "";
        setVirmanForm((prev) => ({
          ...prev,
          source_account_id: `contact:${contactVirmanId}`,
          target_account_id: prev.target_account_id && !String(prev.target_account_id).startsWith("contact:")
            ? prev.target_account_id
            : firstAcc,
        }));
      } else if (manual.length >= 2) {
        setVirmanForm((prev) => ({
          ...prev,
          source_account_id: prev.source_account_id || manual[0].id || manual[0]._id,
          target_account_id: prev.target_account_id || manual[1].id || manual[1]._id
        }));
      }
      if (!silent) setLoading(false);
      await Promise.all([txPromise, contactsPromise]);
    } catch (err) {
      if (!silent) toast.error("Banka verileri yüklenemedi.");
      if (!silent) setLoading(false);
    }
  }, [companyId, contactVirmanId]);
  useEffect(() => { loadBankingData(); }, [loadBankingData]);
  const runServerLoad = useCallback(async (mode) => {
    const ctx = pagingCtx.current;
    if (!ctx.active || !ctx.accountId) return;
    if (mode === "append" && (!ctx.hasMore || ctx.loading)) return;
    const gen = ++serverGenRef.current;
    if (serverAbortRef.current) serverAbortRef.current.abort();
    const ctrl = new AbortController();
    serverAbortRef.current = ctrl;
    ctx.loading = true;
    if (mode === "reset") setServerLoading(true);
    const pageSize = 50;
    const paramsFor = (page) => {
      const params = { page, page_size: pageSize };
      if (ctx.focusTx) params.focus_tx_id = ctx.focusTx;
      if (ctx.focusPending) params.matched = "no";
      return params;
    };
    const pull = async (page) => {
      const { data } = await axios.get(
        `${API_URL}/banking/accounts/${ctx.accountId}/transactions`,
        { params: paramsFor(page), signal: ctrl.signal },
      );
      return data || {};
    };
    try {
      let bodies = [];
      let pages = [];
      if (mode === "append") {
        const lastPage = ctx.pages[ctx.pages.length - 1] || 1;
        const next = lastPage + 1;
        bodies = [await pull(next)];
        pages = [...ctx.pages, next];
      } else if (mode === "refresh" && ctx.pages.length > 1) {
        pages = ctx.pages.slice();
        for (const p of pages) {
          bodies.push(await pull(p));
        }
      } else {
        let body = await pull(1);
        let page = 1;
        const focusPage = Number(body.focus_page);
        if (ctx.focusTx && focusPage > 1) {
          page = focusPage;
          body = await pull(page);
        }
        bodies = [body];
        pages = [page];
      }
      if (gen !== serverGenRef.current) return;
      const last = bodies[bodies.length - 1] || {};
      if (mode === "append") {
        const extra = Array.isArray(bodies[0].items) ? bodies[0].items : [];
        setServerItems((prev) => [...(Array.isArray(prev) ? prev : []), ...extra]);
      } else {
        setServerItems(bodies.flatMap((b) => (Array.isArray(b.items) ? b.items : [])));
      }
      ctx.pages = pages;
      ctx.hasMore = Boolean(last.has_more);
      setServerHasMore(ctx.hasMore);
      setServerTotal(Number(last.total) || 0);
      setServerInflow(Number(last.period_inflow) || 0);
      setServerOutflow(Number(last.period_outflow) || 0);
      setServerLoading(false);
    } catch (err) {
      if (gen !== serverGenRef.current) return;
      const canceled = err?.code === "ERR_CANCELED" || err?.name === "CanceledError" || axios.isCancel?.(err);
      if (canceled) return;
      setServerLoading(false);
      toast.error("Hareketler yüklenemedi.");
    } finally {
      if (gen === serverGenRef.current) ctx.loading = false;
    }
  }, []);
  useEffect(() => {
    if (!serverPaging) return undefined;
    pagingCtx.current.pages = [1];
    pagingCtx.current.hasMore = false;
    setServerItems([]);
    setServerTotal(0);
    setServerInflow(0);
    setServerOutflow(0);
    setServerHasMore(false);
    runServerLoad("reset");
    return () => {
      if (serverAbortRef.current) serverAbortRef.current.abort();
    };
  }, [serverPaging, selectedAccountId, companyId, focusTx, focusPending, runServerLoad]);
  useEffect(() => {
    if (!serverPaging || !serverHasMore) return undefined;
    const el = serverSentinelRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      runServerLoad("append");
    }, { root: null, rootMargin: "240px 0px", threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [serverPaging, serverHasMore, serverItems.length, runServerLoad]);
  const refreshCashSilent = useCallback(() => {
    setCashTick((n) => n + 1);
    if (silentReloadRef.current) return silentReloadRef.current;
    silentReloadRef.current = Promise.resolve(loadBankingData({ silent: true }))
      .then(() => (pagingCtx.current.active ? runServerLoad("refresh") : null))
      .finally(() => {
        silentReloadRef.current = null;
      });
    return silentReloadRef.current;
  }, [loadBankingData, runServerLoad]);
  useDataRefresh(refreshCashSilent, { companyId, scopes: ["cash"] });
  useEffect(() => {
    if (tab !== "reconciliation") return undefined;
    const key = `${companyId}:${cashTick}`;
    if (driftKeyRef.current === key) return undefined;
    let cancelled = false;
    axios.get(`${API_URL}/banking/accounts?company_id=${companyId}&with_drift=1`)
      .then((r) => {
        if (cancelled) return;
        driftKeyRef.current = key;
        if (Array.isArray(r.data)) setAccounts(r.data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [tab, companyId, cashTick]);
  const bumpCashData = useCallback(async (matchedTx) => {
    // Eşleşince satır listeden düşmesin: hemen matched durumunu yerelde yaz.
    if (matchedTx && (matchedTx.id || matchedTx._id)) {
      setTransactions((prev) => mergeMatchedTx(prev, matchedTx));
      if (isBankTxServerPagingEnabled()) setServerItems((prev) => mergeMatchedTx(prev, matchedTx));
    }
    // Cache düşür + diğer ekranlara sinyal; ardından hesap grubu bakiyelerini (accounts + ortak özeti) bekleyerek yenile.
    await notifyDataChanged({ companyId, scopes: ["cash"] });
    await refreshCashSilent();
  }, [companyId, refreshCashSilent]);

  const handleSaveAccount = async (e) => {
    e.preventDefault();
    try {
      const company_id = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
      const isCard = newAccount.type === "credit_card";
      const isCustomerCard = isCard && newAccount.card_owner === "customer";
      const last4 = String(newAccount.card_last4 || "").replace(/\D/g, "").slice(-4);
      const payload = isCustomerCard
        ? {
            type: "credit_card",
            card_owner: "customer",
            is_customer_card_pool: true,
            bank_name: "Müşteri Kartları",
            account_name: "Müşteri Kredi Kartları",
            currency: "TRY",
            current_balance: 0,
          }
        : {
            type: newAccount.type,
            bank_name: newAccount.bank_name,
            account_name: newAccount.account_name,
            currency: newAccount.currency || "TRY",
            current_balance: isCard ? -Math.abs(Number(newAccount.current_balance || 0)) : Number(newAccount.current_balance || 0),
          };
      if (isCard && !isCustomerCard) {
        payload.card_holder = (newAccount.card_holder || "").trim() || null;
        payload.card_last4 = last4 || null;
        payload.card_expiry = (newAccount.card_expiry || "").trim() || null;
        payload.card_limit = newAccount.card_limit === "" || newAccount.card_limit == null ? null : Number(newAccount.card_limit);
        payload.card_owner = "company";
        payload.linked_contact_id = null;
      } else if (!isCard) {
        payload.iban = newAccount.iban;
        payload.account_number = newAccount.account_number;
        if (newAccount.type === "pos" || newAccount.type === "okc_pos") {
          payload.pos_commission_rate = Number(newAccount.pos_commission_rate || 0);
        }
        if (newAccount.type === "okc_pos") {
          payload.okc_brand = (newAccount.okc_brand || "").trim() || null;
          payload.okc_serial = (newAccount.okc_serial || "").trim() || null;
          payload.okc_terminal_id = (newAccount.okc_terminal_id || "").trim() || null;
          payload.okc_api_url = (newAccount.okc_api_url || "").trim() || null;
          payload.okc_api_key = (newAccount.okc_api_key || "").trim() || null;
        }
      }
      if (editingAccount) {
        const { current_balance: _bal, ...meta } = payload;
        await axios.put(`${API_URL}/banking/accounts/${editingAccount.id || editingAccount._id}`, meta);
        toast.success("Hesap güncellendi.");
        setShowAddAccountModal(false);
        setEditingAccount(null);
        setNewAccount(emptyAccountForm);
        await bumpCashData();
      } else {
        const created = (await axios.post(`${API_URL}/banking/accounts`, { company_id, ...payload })).data;
        toast.success(
          isCustomerCard
            ? "Müşteri Kredi Kartları kasası hazır. Cari virmanda «müşteri kredi kartı ile» seçin."
            : isCard
              ? "Kart hesabı kaydedildi. Ekstreyi AI ile yükleyebilirsiniz."
              : "Banka/Kasa hesabı başarıyla eklendi.",
        );
        setShowAddAccountModal(false);
        setEditingAccount(null);
        setNewAccount(emptyAccountForm);
        await bumpCashData();
        if (isCard && !isCustomerCard) setStmtAccount({ ...created, id: created.id || created._id });
      }
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
      pos_commission_rate: acc.pos_commission_rate || 1.5,
      card_holder: acc.card_holder || "",
      card_last4: acc.card_last4 || "",
      card_expiry: acc.card_expiry || "",
      card_limit: acc.card_limit ?? "",
      card_owner: acc.type === "credit_card" && acc.card_owner === "customer" ? "customer" : "company",
      linked_contact_id: acc.linked_contact_id || "",
      okc_brand: acc.okc_brand || "",
      okc_serial: acc.okc_serial || "",
      okc_terminal_id: acc.okc_terminal_id || "",
      okc_api_url: acc.okc_api_url || "",
      okc_api_key: acc.okc_api_key || "",
    });
    setShowAddAccountModal(true);
  };

  const handleDeleteAccount = async (acc, e) => {
    e?.stopPropagation();
    const name = accountDisplayLabel(acc);
    if (!window.confirm(`"${name}" silinsin mi? Hareketi olan hesaplar silinemez.`)) return;
    try {
      const r = await axios.delete(`${API_URL}/banking/accounts/${acc.id || acc._id}`);
      toast.success(r.data.message || "Hesap silindi.");
      if (selectedAccountId === (acc.id || acc._id)) setSelectedAccountId(null);
      await bumpCashData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Hesap silinemedi.");
    }
  };

  const handleExecuteVirman = async (e) => {
    e.preventDefault();
    if (!virmanForm.source_account_id || !virmanForm.target_account_id) {
      toast.error("Kaynak ve hedef seçiniz (hesap/ortak veya cari).");
      return;
    }
    if (!virmanForm.amount || Number(virmanForm.amount) <= 0) {
      toast.error("Geçerli bir tutar giriniz.");
      return;
    }
    if (virmanForm.source_account_id === virmanForm.target_account_id) {
      toast.error("Kaynak ve hedef aynı olamaz.");
      return;
    }
    try {
      const res = await axios.post(`${API_URL}/banking/virman`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        source_account_id: virmanForm.source_account_id,
        target_account_id: virmanForm.target_account_id,
        amount: Number(virmanForm.amount),
        description: virmanForm.description,
        via_customer_card: Boolean(virmanForm.via_customer_card),
      });
      toast.success(res.data.message);
      setShowVirmanModal(false);
      setVirmanForm({ ...virmanForm, amount: "", via_customer_card: false });
      await bumpCashData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Virman işlemi gerçekleştirilemedi.");
    }
  };

  const totalLiquidity = sumLiquidity(accounts);
  const selectedAccount = accounts.find(a => (a.id || a._id) === selectedAccountId);
  const accountDisplayBalance = shownAccountBalance;
  const grouped = ACCOUNT_GROUPS.map((g) => {
    const items = accounts.filter((a) => accountGroupType(a) === g.type);
    return { ...g, items, total: sumShownBalances(items) };
  }).filter((g) => g.items.length > 0);
  const openGroup = grouped.find((g) => g.type === selectedGroup) || null;
  const groupIds = openGroup ? openGroup.items.map((a) => a.id || a._id) : null;
  // Eşleşmiş bank_sync satırları da hesap hareketlerinde kalır (match_status filtresi yok).
  const accountTx = filterAccountTransactions(transactions, {
    accountId: selectedAccountId || null,
    groupIds: selectedAccountId ? null : groupIds,
  });
  const pendingTx = focusPending
    ? accountTx.filter((tx) => (tx.source === "bank_sync" && tx.match_status === "unmatched") || (focusTx && (tx.id || tx._id) === focusTx))
    : accountTx;
  const visibleTx = focusTx
    ? [...pendingTx].sort((a, b) => ((a.id || a._id) === focusTx ? -1 : (b.id || b._id) === focusTx ? 1 : 0))
    : pendingTx;
  const simulatedVisible = visibleTx.filter((tx) => tx.source === "bank_sync" && tx.is_simulated);
  const txInflow = visibleTx.filter(tx => tx.type === 'inflow' || (tx.type === 'transfer' && tx.target_account_id === selectedAccountId)).reduce((s, tx) => s + (tx.amount || 0), 0);
  const txOutflow = visibleTx.filter(tx => tx.type === 'outflow' || (tx.type === 'transfer' && tx.account_id === selectedAccountId)).reduce((s, tx) => s + (tx.amount || 0), 0);
  const { visible: pagedTx, hasMore: txHasMore, sentinelRef: txSentinelRef } = useInfiniteRows(visibleTx, {
    resetKey: `${selectedAccountId || ""}|${selectedGroup || ""}`,
  });
  const listRows = serverPaging ? serverItems : pagedTx;
  const listHasMore = serverPaging ? serverHasMore : txHasMore;
  const listSentinelRef = serverPaging ? serverSentinelRef : txSentinelRef;
  const listInflow = serverPaging ? serverInflow : txInflow;
  const listOutflow = serverPaging ? serverOutflow : txOutflow;
  const listCount = serverPaging ? serverTotal : visibleTx.length;

  const clearSimulated = async () => {
    if (!simulatedVisible.length) {
      toast.info("Görünen listede simüle hareket yok.");
      return;
    }
    if (!window.confirm(`${simulatedVisible.length} simüle (demo) banka hareketi silinsin mi? Bakiyeler geri alınır.`)) return;
    try {
      if (selectedAccountId) {
        const r = await axios.delete(`${API_URL}/banking/transactions/simulated`, { params: { company_id: companyId, account_id: selectedAccountId } });
        toast.success(r.data.message);
      } else if (groupIds?.length) {
        let removed = 0;
        for (const aid of groupIds) {
          const r = await axios.delete(`${API_URL}/banking/transactions/simulated`, { params: { company_id: companyId, account_id: aid } });
          removed += Number(r.data.removed || 0);
        }
        toast.success(`${removed} simüle (demo) banka hareketi çöp kutusuna taşındı.`);
      } else {
        const r = await axios.delete(`${API_URL}/banking/transactions/simulated`, { params: { company_id: companyId } });
        toast.success(r.data.message);
      }
      await bumpCashData();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Simüle hareketler silinemedi.");
    }
  };

  return (
    <div className="space-y-6" data-testid="banking-page">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Banka, Kasa & POS Yönetimi</h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Toplam Likidite: <span className="font-bold text-emerald-600">{formatTrAmount(totalLiquidity)} ₺</span>
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => {
              const manual = accounts.filter((a) => !a.is_integrated);
              if (manual.length >= 2) {
                setVirmanForm((prev) => ({
                  ...prev,
                  source_account_id: manual[0].id || manual[0]._id,
                  target_account_id: manual[1].id || manual[1]._id,
                }));
              }
              setShowVirmanModal(true);
            }}
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

      {tab === "partners" && <PartnersPanel companyId={companyId} accounts={accounts} onCashChanged={bumpCashData} />}
      {tab === "reconciliation" && <ReconciliationPanel companyId={companyId} />}
      {tab === "connections" && <BankConnectionsPanel companyId={companyId} accounts={accounts} contacts={contacts} onSynced={bumpCashData} />}

      {tab === "accounts" && (<>
      <CashApprovalsBanner companyId={companyId} refreshKey={cashTick} onChanged={bumpCashData} />
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
                <div className="text-xs text-slate-500">Toplam {PARTNER_RECEIVED_LABEL}: {(partnerSummary.total_cash_in ?? partnerSummary.total_capital_in).toLocaleString('tr-TR')} ₺ • Toplam {PARTNER_PAID_LABEL}: {(partnerSummary.total_cash_out ?? partnerSummary.total_withdrawn).toLocaleString('tr-TR')} ₺</div>
              </div>
            </div>
            <div className="pt-3 border-t border-amber-200/60">
              {(() => {
                // Ortak kartlarıyla aynı kaynak: present_partner_balance (total_card_pocket)
                const meta = partnerSummaryCardMeta(partnerSummary);
                return (
                  <>
                    <div className="text-[10px] text-slate-400 uppercase font-semibold" data-testid="partners-account-badge">{meta.label}</div>
                    <div className={`text-xl font-bold tracking-tight ${meta.amountCls}`} data-testid="partners-account-balance">{formatTrAmount(meta.display)} ₺</div>
                  </>
                );
              })()}
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
                {g.type === "credit_card" && (
                  <div className="text-[10px] font-bold text-fuchsia-800 bg-fuchsia-50 border border-fuchsia-200 rounded-md px-2 py-0.5 w-fit">
                    Tahsilat kapalı · şirket kartı · masraf / ekstre
                  </div>
                )}
                {g.type === "customer_credit_card" && (
                  <div className="text-[10px] font-bold text-rose-800 bg-rose-50 border border-rose-200 rounded-md px-2 py-0.5 w-fit">
                    Cari virman · müşteri kredi kartı ile işaretlenen hareketler
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{g.items.length} {g.unit}</h3>
                  <div className="text-xs text-slate-500 truncate">{g.items.map((a) => a.bank_name).filter(Boolean).slice(0, 3).join(" · ") || "—"}</div>
                  {g.items.some((a) => a.is_integrated) && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.items.filter((a) => a.is_integrated).slice(0, 3).map((a) => (
                        <span key={a.id || a._id} className="inline-flex items-center gap-0.5 text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5" data-testid={`group-integrated-${a.id || a._id}`}>
                          <Link2 className="w-2.5 h-2.5" /> {a.integration_provider || "Entegre"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className={`pt-3 border-t ${g.border} flex items-end justify-between gap-2`}>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">{g.type === "credit_card" || g.type === "customer_credit_card" ? "Kart bakiyesi" : "Toplam Bakiye"}</div>
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
              const isCustomerCard = isCard && acc.card_owner === "customer";
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
                        <h3 className="font-bold text-slate-900 text-sm break-words">{accountDisplayLabel(acc)}</h3>
                        <div className="text-xs text-slate-500">{accountTypeLabel(acc.type)}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={(e) => openEditAccount(acc, e)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100" title="Düzelt" data-testid={`edit-account-${accId}`}><Pencil className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={(e) => handleDeleteAccount(acc, e)} disabled={acc.is_integrated} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30" title={acc.is_integrated ? "Entegre hesap silinemez" : "Sil"} data-testid={`delete-account-${accId}`}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    {acc.is_integrated && (
                      <div
                        className={`flex items-center gap-1 text-[10px] font-bold rounded-md px-2 py-0.5 w-fit border ${
                          acc.integration_status === "connected"
                            ? "text-emerald-800 bg-emerald-50 border-emerald-200"
                            : acc.integration_status === "error"
                              ? "text-rose-800 bg-rose-50 border-rose-200"
                              : "text-blue-700 bg-blue-50 border-blue-200"
                        }`}
                        data-testid={`integrated-badge-${accId}`}
                      >
                        <Link2 className="w-3 h-3" />
                        ENTEGRE · {acc.integration_provider || "Banka API"}
                        {acc.integration_status === "connected" ? " · CANLI" : acc.integration_status === "error" ? " · HATA" : acc.integration_status === "simulated" ? " · SİMÜLE" : ""}
                      </div>
                    )}
                    {acc.bank_balance_drift && (
                      <div className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-0.5 w-fit" data-testid={`balance-drift-${accId}`}>
                        Banka bakiyesi defterden farklı
                      </div>
                    )}
                    {isCard && (
                      <div className={`text-[10px] font-bold rounded-md px-2 py-0.5 w-fit border ${isCustomerCard ? "text-rose-800 bg-rose-50 border-rose-200" : "text-fuchsia-800 bg-fuchsia-50 border-fuchsia-200"}`} data-testid={`card-no-collect-${accId}`}>
                        {isCustomerCard
                          ? (acc.is_customer_card_pool
                            ? "Cari virman · müşteri kredi kartı ile işaretlenen hareketler"
                            : `Müşteri kartı · ${acc.linked_contact_name || "cari"}`)
                          : "Şirket kartı · tahsilat kapalı · masraf / ekstre"}
                      </div>
                    )}
                    {isCard && <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[10px] text-slate-400">{acc.card_limit ? `Limit ${Number(acc.card_limit).toLocaleString("tr-TR")} ₺` : "Limit —"}{acc.last_statement?.due_date ? ` · Son ödeme ${fmtDate(acc.last_statement.due_date)}` : ""}</span><button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStmtAccount({ ...acc, id: accId }); }} className="text-[10px] font-semibold text-fuchsia-700 bg-fuchsia-50 hover:bg-fuchsia-100 px-2 py-0.5 rounded-md" data-testid={`card-stmt-btn-${accId}`}>Ekstre Aktar (AI)</button></div>}
                    {canUploadBankStatement(acc) && (
                      <div className="mt-1 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setStmtAccount({ ...acc, id: accId }); }}
                          className="text-[10px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 px-2 py-0.5 rounded-md"
                          title="PDF, Excel veya CSV hesap hareketi yükle"
                          data-testid={`bank-stmt-btn-${accId}`}
                        >
                          Hareket Yükle (AI)
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="pt-3 border-t border-slate-100 flex items-end justify-between gap-2">
                    <div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">{isCard ? "Kart bakiyesi" : "Mevcut Bakiye"}</div>
                      <div className="text-lg font-bold text-slate-900 tracking-tight" data-testid={acc.is_customer_card_pool ? `pool-balance-${accId}` : undefined}>
                        {money(acc.is_customer_card_pool ? 0 : acc.current_balance)} ₺
                      </div>
                      {acc.is_customer_card_pool && (
                        <div className="text-[10px] text-slate-400 mt-0.5">Giriş + çıkış eşlenik · net 0</div>
                      )}
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
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-x-hidden min-w-0 space-y-3 p-5" data-testid="transactions-panel">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" />
            <h2 className="text-base font-bold text-slate-900" data-testid="transactions-title">{selectedAccount ? `${accountDisplayLabel(selectedAccount)} Hareketleri` : openGroup ? `${openGroup.badge} Hareketleri` : "Son Finansal Hareketler"}</h2>
            {(selectedAccount || openGroup) && (
              <button onClick={() => { setSelectedAccountId(null); if (selectedAccount) return; setSelectedGroup(null); }} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-full transition" data-testid="clear-account-filter-btn"><X className="w-3 h-3" /> {selectedAccount ? "Grup Hareketleri" : "Tüm Hesaplar"}</button>
            )}
          </div>
          {selectedAccount || openGroup ? (
            <div className="flex items-center gap-3 text-[11px]" data-testid="account-tx-summary">
              <span className="text-slate-500">{listCount} hareket</span>
              <span className="font-semibold text-emerald-600">Giren +{formatTrAmount(listInflow)} ₺</span>
              <span className="font-semibold text-rose-600">Çıkan -{formatTrAmount(listOutflow)} ₺</span>
            </div>
          ) : (
            <span className="text-xs text-slate-400">Tahsilat, Tediye ve Virman İşlemleri • Gruba veya hesaba tıklayınca filtrelenir</span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {simulatedVisible.length > 0 && (
              <button
                type="button"
                onClick={clearSimulated}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
                data-testid="clear-simulated-tx-btn"
                title="Banka entegrasyonundan gelen simüle (demo) hareketleri sil"
              >
                <Trash2 className="w-3.5 h-3.5" /> Simüleleri Sil ({simulatedVisible.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => { if (!visibleTx.length) { toast.error("Yazdırılacak hareket yok."); return; } setPrintTx(true); }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
              disabled={!visibleTx.length}
              data-testid="print-statements-btn"
            >
              <Printer className="w-3.5 h-3.5" /> Ekstreleri Yazdır
            </button>
          </div>
        </div>

        {(() => {
          const emptyTxLabel = serverPaging && serverLoading && serverItems.length === 0
            ? "Hareketler yükleniyor…"
            : (selectedAccount ? "Bu hesaba ait hareket bulunmuyor." : "Henüz finansal hareket kaydı bulunmuyor.");
          const bankKind = (tx) => (tx.type === "inflow" ? "Giriş" : tx.type === "outflow" ? "Çıkış" : "Virman");
          const bankAmount = (tx) => (tx.type === "inflow" ? `+${tx.amount?.toLocaleString("tr-TR")} ₺` : tx.type === "outflow" ? `-${tx.amount?.toLocaleString("tr-TR")} ₺` : `${tx.amount?.toLocaleString("tr-TR")} ₺`);
          const bankAmountCls = (tx) => (tx.type === "inflow" ? "text-emerald-600" : tx.type === "outflow" ? "text-rose-600" : "text-indigo-600");
          const bankDesc = (tx) => {
            const bits = [txDescriptionLabel(tx)];
            if (tx.owner_contact_name && tx.owner_contact_name !== tx.contact_name) bits.push(`kart sahibi ${tx.owner_contact_name}`);
            if (tx.category) bits.push(tx.category);
            const actor = txUserColumnLabel(tx);
            if (actor) bits.push(actor);
            return bits.filter(Boolean).join(" · ");
          };
          const bankExtra = (tx, prefix) => (
            <div className="flex flex-wrap gap-1">
              {tx.customer_card && <span className="text-[9px] px-1 rounded font-bold bg-rose-100 text-rose-800" data-testid={`${prefix}tx-customer-card-${tx.id || tx._id}`}>MÜŞTERİ KARTI</span>}
              {tx.source === "bank_sync" && <span className={`text-[9px] px-1 rounded font-bold ${tx.is_simulated ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{tx.is_simulated ? "SİMÜLE" : "BANKA"}</span>}
              {tx.source === "bank_sync" && tx.match_status === "matched" && <span className="text-[9px] px-1 rounded font-bold bg-emerald-100 text-emerald-700" title={matchActorTitle(tx)} data-testid={`${prefix}tx-matched-${tx.id}`}>{matchStatusLabel(tx)}</span>}
              {tx.source === "bank_sync" && tx.match_status === "unmatched" && <span className="text-[9px] px-1 rounded font-bold bg-slate-100 text-slate-500">EŞLEŞME BEKLİYOR</span>}
              {tx.source === "bank_match" && <span className="text-[9px] px-1 rounded font-bold bg-indigo-100 text-indigo-700">BANKA VİRMANI</span>}
            </div>
          );
          const cards = listRows.length === 0 ? (
            <div className="text-center text-slate-400 py-6">{emptyTxLabel}</div>
          ) : (
            listRows.map((tx) => {
              const id = tx.id || tx._id;
              return (
                <TxMobileCard
                  key={`card-${id}`}
                  testId={`tx-card-${id}`}
                  className={(tx.id || tx._id) === focusTx ? "ring-2 ring-amber-400 bg-amber-50" : ""}
                  date={fmtDate(tx.date)}
                  party={txAccountLabel(tx, accounts)}
                  badge={<TxTypeBadge label={bankKind(tx)} kind={tx.type} />}
                  amount={bankAmount(tx)}
                  amountClassName={bankAmountCls(tx)}
                  description={bankDesc(tx)}
                  extra={bankExtra(tx, "card-")}
                  actions={<TxRowMenu tx={tx} accounts={accounts} company={activeCompany} contacts={contacts} onChanged={bumpCashData} />}
                />
              );
            })
          );
          const table = (
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-4 py-2.5">Tarih</th>
                <th className="px-4 py-2.5">Hesap / Kasa</th>
                <th className="px-4 py-2.5">İşlem Türü & Kategori</th>
                <th className="px-4 py-2.5">Açıklama / Cari</th>
                <th className="px-4 py-2.5">Kullanıcı</th>
                <th className="px-4 py-2.5 text-right">Tutar</th>
                <th className="px-3 py-2.5 text-right w-12">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {listRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">{emptyTxLabel}</td>
                </tr>
              ) : (
                listRows.map((tx) => (
                  <tr key={tx.id || tx._id} className={`hover:bg-slate-50/70 transition [content-visibility:auto] [contain-intrinsic-size:auto_40px] ${(tx.id || tx._id) === focusTx ? "bg-amber-50 ring-2 ring-inset ring-amber-400" : ""}`} data-testid={`tx-row-${tx.id || tx._id}`}>
                    <td className="px-4 py-2.5 text-slate-500 font-mono" data-testid={`tx-date-${tx.id || tx._id}`}>{fmtDate(tx.date)}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-900">{txAccountLabel(tx, accounts)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-semibold ${
                        tx.type === 'inflow' ? 'bg-emerald-50 text-emerald-700' : tx.type === 'outflow' ? 'bg-rose-50 text-rose-700' : 'bg-indigo-50 text-indigo-700'
                      }`}>
                        {tx.type === 'inflow' ? <ArrowDownRight className="w-3 h-3" /> : tx.type === 'outflow' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowRightLeft className="w-3 h-3" />}
                        {tx.category || tx.type}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 text-slate-700 ${TX_WRAP_CLASS}`} data-testid={`tx-desc-${tx.id || tx._id}`}>
                      <span className="font-medium text-slate-800">{txDescriptionLabel(tx)}</span>
                      {tx.owner_contact_name && tx.owner_contact_name !== tx.contact_name ? ` · kart sahibi ${tx.owner_contact_name}` : ""}
                      {" "}
                      {tx.customer_card && <span className="ml-1 text-[9px] px-1 rounded font-bold bg-rose-100 text-rose-800" data-testid={`tx-customer-card-${tx.id || tx._id}`}>MÜŞTERİ KARTI</span>}
                      {tx.source === "bank_sync" && <span className={`ml-1 text-[9px] px-1 rounded font-bold ${tx.is_simulated ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{tx.is_simulated ? "SİMÜLE" : "BANKA"}</span>}
                      {tx.source === "bank_sync" && tx.match_status === "matched" && <span className="ml-1 text-[9px] px-1 rounded font-bold bg-emerald-100 text-emerald-700" title={matchActorTitle(tx)} data-testid={`tx-matched-${tx.id}`}>{matchStatusLabel(tx)}</span>}
                      {tx.source === "bank_sync" && tx.match_status === "unmatched" && <span className="ml-1 text-[9px] px-1 rounded font-bold bg-slate-100 text-slate-500">EŞLEŞME BEKLİYOR</span>}
                      {tx.source === "bank_match" && <span className="ml-1 text-[9px] px-1 rounded font-bold bg-indigo-100 text-indigo-700">BANKA VİRMANI</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap" data-testid={`tx-actor-${tx.id || tx._id}`} title={txUserColumnLabel(tx) || undefined}>
                      {txUserColumnLabel(tx) || <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-bold ${bankAmountCls(tx)}`}>
                      {bankAmount(tx)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <TxRowMenu tx={tx} accounts={accounts} company={activeCompany} contacts={contacts} onChanged={bumpCashData} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          );
          return (
            <TxResponsiveList
              cards={cards}
              table={table}
              cardsTestId="bank-tx-cards"
              tableWrapTestId="bank-tx-table-wrap"
            />
          );
        })()}
        {listHasMore && (
          <div ref={listSentinelRef} className="pt-2 text-center text-[11px] text-slate-400" data-testid="transactions-load-more">
            Daha fazla hareket yükleniyor…
          </div>
        )}
      </div>
      {printTx && (
        <AccountStatementPrint
          company={activeCompany}
          account={selectedAccount || null}
          title={selectedAccount ? accountDisplayLabel(selectedAccount) : openGroup ? `${openGroup.badge} Hareketleri` : "Son Finansal Hareketler"}
          transactions={visibleTx}
          onClose={() => setPrintTx(false)}
        />
      )}
      </>)}

      {/* VIRMAN MODAL */}
      {showVirmanModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto" data-testid="virman-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">Hesaplar Arası Virman (Para Transferi)</h3>
              <button onClick={() => setShowVirmanModal(false)} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleExecuteVirman} className="space-y-3 text-xs">
              <p className="text-[11px] text-slate-500">Kasa, banka, POS, kredi kartı, ortak veya cari arasında transfer. Kaynak/hedef için hesap veya cari ayrı seçilir; cari arama ile bulunur. Hesap→cari ödeme, cari→hesap tahsilat.</p>
              <VirmanPartySelect
                companyId={companyId}
                accounts={accounts}
                contacts={contacts}
                value={virmanForm.source_account_id}
                onChange={(v) => setVirmanForm({ ...virmanForm, source_account_id: v, via_customer_card: String(v || "").startsWith("contact:") || String(virmanForm.target_account_id || "").startsWith("contact:") ? virmanForm.via_customer_card : false })}
                testId="virman-source"
                label="Kaynak (Çıkış)"
                includePartners
                excludeIntegrated
              />
              <VirmanPartySelect
                companyId={companyId}
                accounts={accounts}
                contacts={contacts}
                value={virmanForm.target_account_id}
                onChange={(v) => setVirmanForm({ ...virmanForm, target_account_id: v, via_customer_card: String(virmanForm.source_account_id || "").startsWith("contact:") || String(v || "").startsWith("contact:") ? virmanForm.via_customer_card : false })}
                testId="virman-target"
                label="Hedef (Giriş)"
                includePartners
                excludeIntegrated
              />
              {(String(virmanForm.source_account_id || "").startsWith("contact:") || String(virmanForm.target_account_id || "").startsWith("contact:")) && (
                <label className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-3 cursor-pointer" data-testid="virman-via-customer-card">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={Boolean(virmanForm.via_customer_card)}
                    onChange={(e) => setVirmanForm({ ...virmanForm, via_customer_card: e.target.checked })}
                    data-testid="virman-via-customer-card-input"
                  />
                  <span>
                    <span className="font-semibold text-rose-900">Müşteri kredi kartı ile virman yapıldı</span>
                    <span className="block text-[11px] text-rose-800/90 mt-0.5">Hareket Müşteri Kredi Kartları kasasında listelenir.</span>
                  </span>
                </label>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Transfer Tutarı (₺)</label>
                <MoneyInput
                  placeholder="0.00"
                  value={virmanForm.amount}
                  onChange={(n) => setVirmanForm({ ...virmanForm, amount: n ?? "" })}
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
          <div className={`bg-white rounded-2xl w-full p-6 space-y-4 shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto ${newAccount.type === "credit_card" || newAccount.type === "okc_pos" ? "max-w-lg" : "max-w-md"}`} data-testid="add-account-modal">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-base font-bold text-slate-900">{editingAccount ? "Hesabı Düzelt" : "Yeni Banka / Kasa / POS Hesabı"}</h3>
              <button type="button" onClick={() => { setShowAddAccountModal(false); setEditingAccount(null); setStmtFile(null); }} className="text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveAccount} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Hesap Türü</label>
                <select
                  value={accountTypeSelectValue(newAccount)}
                  onChange={(e) => {
                    const v = e.target.value;
                    const isCustomer = v === "customer_credit_card";
                    const type = isCustomer ? "credit_card" : v;
                    const defaultName = isCustomer
                      ? "Müşteri Kartı"
                      : type === "credit_card"
                        ? "Şirket Kartı"
                        : newAccount.account_name;
                    setNewAccount({
                      ...newAccount,
                      type,
                      card_owner: isCustomer ? "customer" : "company",
                      linked_contact_id: isCustomer ? newAccount.linked_contact_id : "",
                      account_name: (newAccount.account_name === "Vadesiz TL Hesabı" || newAccount.account_name === "Şirket Kartı" || newAccount.account_name === "Müşteri Kartı")
                        ? defaultName
                        : newAccount.account_name,
                    });
                    if (type !== "credit_card") setStmtFile(null);
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
                  data-testid="account-type-select"
                >
                  <option value="bank">Banka Vadesiz Ticari</option>
                  <option value="cash_box">Nakit Kasa</option>
                  <option value="pos">POS Cihazı / Sanal POS</option>
                  <option value="okc_pos">ÖKC POS Cihazı</option>
                  <option value="credit_card">Kredi Kartı (Şirket Kartı)</option>
                  <option value="customer_credit_card">Müşteri Kredi Kartı</option>
                </select>
              </div>
              {newAccount.type === "credit_card" && newAccount.card_owner === "customer" ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 space-y-1" data-testid="customer-card-pool-hint">
                  <p className="text-[11px] font-semibold text-rose-900">Müşteri Kredi Kartları kasası</p>
                  <p className="text-[11px] text-rose-800/90">
                    Kart / cari bilgisi girilmez. Cari virmanda «Müşteri kredi kartı ile virman yapıldı» işaretlenince hareketler bu kasada görünür.
                  </p>
                </div>
              ) : (
              <>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{newAccount.type === "okc_pos" ? "Marka / Kurum" : "Banka / Kurum Adı"}</label>
                <input
                  type="text"
                  placeholder={newAccount.type === "okc_pos" ? "Örn: Hugin, Beko, Ingenico, PAX" : "Örn: Garanti BBVA, Yapı Kredi, Merkez Kasa"}
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
                  placeholder={newAccount.type === "credit_card" ? "Örn: Pazarlama Kartı" : "Örn: Ana Ticari TL Hesabı"}
                  value={newAccount.account_name}
                  onChange={(e) => setNewAccount({ ...newAccount, account_name: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                  data-testid="account-name-input"
                />
              </div>
              {newAccount.type === "credit_card" ? (
                <div className="space-y-3 rounded-xl border border-fuchsia-100 bg-fuchsia-50/40 p-3" data-testid="card-details-fields">
                  <p className="text-[11px] text-fuchsia-800 font-medium">Kart numarası ve CVV kaydedilmez. Yalnızca isim, son 4 hane, SKT ve limit tutulur.</p>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Kart Üzerindeki İsim</label>
                    <input
                      type="text"
                      placeholder="Örn: MUSTAFA BAL"
                      value={newAccount.card_holder}
                      onChange={(e) => setNewAccount({ ...newAccount, card_holder: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2"
                      data-testid="card-holder-input"
                      autoComplete="cc-name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Son 4 Hane</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={19}
                        placeholder="1234"
                        value={newAccount.card_last4}
                        onChange={(e) => setNewAccount({ ...newAccount, card_last4: e.target.value.replace(/\D/g, "").slice(-4) })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono"
                        data-testid="card-last4-input"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Son Kullanma (AA/YY)</label>
                      <input
                        type="text"
                        placeholder="12/28"
                        maxLength={5}
                        value={newAccount.card_expiry}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                          let v = digits;
                          if (digits.length >= 3) v = `${digits.slice(0, 2)}/${digits.slice(2)}`;
                          else if (digits.length === 2 && String(newAccount.card_expiry || "").replace(/\D/g, "").length === 1) v = `${digits}/`;
                          setNewAccount({ ...newAccount, card_expiry: v });
                        }}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono"
                        data-testid="card-expiry-input"
                        autoComplete="cc-exp"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Kart Limiti (₺)</label>
                    <MoneyInput
                      placeholder="0"
                      value={newAccount.card_limit}
                      onChange={(n) => setNewAccount({ ...newAccount, card_limit: n ?? "" })}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2"
                      data-testid="card-limit-input"
                    />
                  </div>
                  <label className="flex items-start gap-2 border-2 border-dashed border-fuchsia-200 rounded-xl p-3 cursor-pointer hover:bg-white" data-testid="card-stmt-on-create">
                    <Sparkles className="w-4 h-4 text-fuchsia-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800">Ekstre yükle (AI)</div>
                      <div className="text-slate-500">{stmtFile ? stmtFile.name : "PDF seçin; hesap kaydedilince analiz ekranı açılır. Satırlar cari / masraf ile eşleşir."}</div>
                    </div>
                    <input type="file" accept="application/pdf,text/plain" className="hidden" onChange={(e) => setStmtFile(e.target.files?.[0] || null)} data-testid="add-account-stmt-file" />
                  </label>
                </div>
              ) : (
                <>
                  {newAccount.type === "okc_pos" && (
                    <div className="space-y-3 rounded-xl border border-teal-100 bg-teal-50/40 p-3" data-testid="okc-connection-fields">
                      <p className="text-[11px] text-teal-800 font-medium">ÖKC (Ödeme Kaydedici Cihaz) API bağlantısı — satış fişi / Z raporu senkronu için uç nokta ve kimlik bilgilerini girin.</p>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">ÖKC Markası</label>
                        <select
                          value={newAccount.okc_brand}
                          onChange={(e) => setNewAccount({ ...newAccount, okc_brand: e.target.value })}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2"
                          data-testid="okc-brand-select"
                        >
                          <option value="">Seçin</option>
                          <option value="hugin">Hugin</option>
                          <option value="beko">Beko</option>
                          <option value="ingenico">Ingenico</option>
                          <option value="pax">PAX</option>
                          <option value="inpos">Inpos</option>
                          <option value="verifone">Verifone</option>
                          <option value="other">Diğer</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block font-semibold text-slate-700 mb-1">Seri No</label>
                          <input
                            type="text"
                            placeholder="Cihaz seri no"
                            value={newAccount.okc_serial}
                            onChange={(e) => setNewAccount({ ...newAccount, okc_serial: e.target.value })}
                            className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono"
                            data-testid="okc-serial-input"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-slate-700 mb-1">Terminal ID</label>
                          <input
                            type="text"
                            placeholder="Terminal / Sicil no"
                            value={newAccount.okc_terminal_id}
                            onChange={(e) => setNewAccount({ ...newAccount, okc_terminal_id: e.target.value })}
                            className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono"
                            data-testid="okc-terminal-input"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Bağlantı URL (API)</label>
                        <input
                          type="url"
                          placeholder="https://..."
                          value={newAccount.okc_api_url}
                          onChange={(e) => setNewAccount({ ...newAccount, okc_api_url: e.target.value })}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono text-[11px]"
                          data-testid="okc-api-url-input"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">API Anahtarı</label>
                        <input
                          type="password"
                          placeholder="••••••••"
                          value={newAccount.okc_api_key}
                          onChange={(e) => setNewAccount({ ...newAccount, okc_api_key: e.target.value })}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 font-mono"
                          data-testid="okc-api-key-input"
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  )}
                  {(newAccount.type === "pos" || newAccount.type === "okc_pos") && (
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">POS Komisyon Oranı (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={newAccount.pos_commission_rate}
                        onChange={(e) => setNewAccount({ ...newAccount, pos_commission_rate: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2"
                        data-testid="pos-commission-input"
                      />
                    </div>
                  )}
                  {newAccount.type !== "okc_pos" && (
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
                  )}
                </>
              )}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{newAccount.type === "credit_card" ? "Mevcut Kart Borcu (₺)" : "Açılış Bakiyesi (₺)"}</label>
                <MoneyInput
                  value={newAccount.current_balance}
                  onChange={(n) => setNewAccount({ ...newAccount, current_balance: n ?? "" })}
                  disabled={!!editingAccount}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 disabled:text-slate-400"
                />
                {editingAccount && <p className="text-[10px] text-slate-400 mt-1">Bakiye hareketlerle değişir; düzeltmede değiştirilmez.</p>}
              </div>
              </>
              )}
              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => { setShowAddAccountModal(false); setEditingAccount(null); setStmtFile(null); }}
                  className="px-3 py-1.5 border rounded-lg text-xs"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold"
                  data-testid="save-account-btn"
                >
                  {editingAccount
                    ? "Değişiklikleri Kaydet"
                    : (newAccount.type === "credit_card" && newAccount.card_owner === "customer")
                      ? "Kasayı Oluştur"
                      : "Hesabı Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {stmtAccount && (
        <CardStatementImport
          account={{ ...stmtAccount, company_id: stmtAccount.company_id || companyId }}
          contacts={asContactList(contacts)}
          initialFile={stmtFile}
          onClose={() => { setStmtAccount(null); setStmtFile(null); }}
          onDone={bumpCashData}
        />
      )}
    </div>
  );
}
