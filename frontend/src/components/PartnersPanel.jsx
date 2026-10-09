
import React, { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Camera, Users, Plus, ArrowDownRight, ArrowUpRight, ArrowLeftRight, X, Trash2, Pencil, Banknote } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { PaymentTargetSelect } from "./PaymentTargetSelect";
import { VirmanPartySelect } from "./VirmanPartySelect";
import { PartnerTxTable } from "./PartnerTxTable";
import { CashApprovalsBanner } from "./CashApprovalsBanner";
import { notifyDataChanged, useDataRefresh } from "../utils/dataRefresh";
import { formatTrAmount } from "../utils/money";
import { resolveImageUrl } from "../utils/imageUrl";
import { compressImageFile } from "../utils/compressImage";
import { isPartnerCashType, isPartnerLedgerType, PARTNER_TX_LABEL, partnerBalanceMeta, partnerLedgerBreakdown, partnerSalaryCardText, partnerSalarySaveMessage, todayIsoDate } from "../utils/partnerTx";

const fmt = (n) => formatTrAmount((n || 0));
const TX_LABEL = PARTNER_TX_LABEL;

/** Filter partner ledger rows to one partner (or keep all when unselected). */
export const filterPartnerTxs = (txs, partnerId) => {
  if (!partnerId) return txs || [];
  return (txs || []).filter((t) => t.partner_id === partnerId);
};

const bal = (a) => Number(a?.current_balance ?? a?.balance ?? 0);
const accId = (a) => a?.id || a?._id || "";
const accLabel = (a) => {
  const name = a?.account_name || a?.name || "Hesap";
  const bank = a?.bank_name && a.bank_name !== name ? a.bank_name : "";
  return `${bank ? `${bank} — ` : ""}${name} · ${fmt(bal(a))} ₺`;
};
const isCard = (a) => String(a?.type || "") === "credit_card";
const isIntegrated = (a) => !!(a?.is_integrated);

const Modal = ({ title, onClose, children, testId }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200" data-testid={testId}>
      <div className="flex items-center justify-between border-b pb-2">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
      </div>
      {children}
    </div>
  </div>
);

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";

export const PartnersPanel = ({ companyId, accounts, onCashChanged }) => {
  const [partners, setPartners] = useState([]);
  const [summary, setSummary] = useState(null);
  const [txs, setTxs] = useState([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState(null);
  const [modal, setModal] = useState(null); // add | tx | salary | edit | virman
  const [liveAccounts, setLiveAccounts] = useState(() => accounts || []);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [partnerForm, setPartnerForm] = useState({ name: "", share_percent: "", phone: "", email: "", monthly_salary: "", salary_start_date: "", salary_recurring: true });
  const [txForm, setTxForm] = useState({ partner_id: "", type: "capital_in", amount: "", account_id: "", description: "" });
  const [virmanForm, setVirmanForm] = useState({ source_account_id: "", target_account_id: "", amount: "", description: "Hesaplar arası transfer (Virman)", via_customer_card: false });

  const selectedPartner = useMemo(() => partners.find((p) => p.id === selectedPartnerId) || null, [partners, selectedPartnerId]);
  const visibleTxs = useMemo(() => filterPartnerTxs(txs, selectedPartnerId), [txs, selectedPartnerId]);
  const partnerLedgers = useMemo(() => {
    const map = {};
    for (const p of partners) {
      map[p.id] = partnerLedgerBreakdown(filterPartnerTxs(txs, p.id), p.balance);
    }
    return map;
  }, [partners, txs]);
  const selectedLedger = useMemo(
    () => (selectedPartner ? partnerLedgers[selectedPartner.id] || null : null),
    [selectedPartner, partnerLedgers],
  );

  useEffect(() => {
    if (selectedPartnerId && !partners.some((p) => p.id === selectedPartnerId)) setSelectedPartnerId(null);
  }, [partners, selectedPartnerId]);

  const selectPartner = (id) => setSelectedPartnerId((cur) => (cur === id ? null : id));

  const load = useCallback(async () => {
    try {
      await axios.post(`${API_URL}/banking/partners/accrue-salary`, { company_id: companyId }).catch(() => null);
      const [p, s, t] = await Promise.all([
        axios.get(`${API_URL}/banking/partners?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/partners/summary?company_id=${companyId}`),
        axios.get(`${API_URL}/banking/partners/transactions?company_id=${companyId}`)
      ]);
      setPartners(p.data); setSummary(s.data); setTxs(t.data);
    } catch { toast.error("Ortak verileri yüklenemedi."); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setLiveAccounts(accounts || []); }, [accounts]);
  useDataRefresh(load, { companyId, scopes: ["cash"] });

  const bumpCash = useCallback(async () => {
    await notifyDataChanged({ companyId, scopes: ["cash"] });
  }, [companyId]);

  const refreshAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const r = await axios.get(`${API_URL}/banking/accounts?company_id=${companyId}`);
      const list = Array.isArray(r.data) ? r.data : [];
      setLiveAccounts(list);
      return list;
    } catch {
      toast.error("Kasa / banka listesi yenilenemedi.");
      return liveAccounts;
    } finally {
      setAccountsLoading(false);
    }
  }, [companyId, liveAccounts]);

  const cashAccounts = liveAccounts.filter((a) => !isCard(a));
  // Virman: kredi kartları + ortaklar (UI); entegre hesaplar hariç.
  const transferAccounts = liveAccounts.filter((a) => !isIntegrated(a));
  const firstAcc = accId(cashAccounts[0]) || accId(liveAccounts[0]) || "";

  const openTxModal = async () => {
    const list = await refreshAccounts();
    const cash = list.filter((a) => !isCard(a));
    setTxForm({ partner_id: selectedPartnerId || partners[0]?.id || "", type: "capital_in", amount: "", account_id: accId(cash[0]) || accId(list[0]) || "", description: "" });
    setModal("tx");
  };

  const openVirmanModal = async () => {
    const list = await refreshAccounts();
    const eligible = list.filter((a) => !isIntegrated(a));
    const activePartners = partners.filter((p) => p.is_active !== false);
    const first = accId(eligible[0]) || (activePartners[0] ? `partner:${activePartners[0].id}` : "");
    const second = accId(eligible[1])
      || (activePartners[1] ? `partner:${activePartners[1].id}` : "")
      || (activePartners[0] ? `partner:${activePartners[0].id}` : "")
      || accId(eligible[0])
      || first;
    setVirmanForm({
      source_account_id: first,
      target_account_id: second !== first ? second : (accId(eligible[0]) || first),
      amount: "",
      description: "Hesaplar arası transfer (Virman)",
    });
    setModal("virman");
  };

  const saveVirman = async (e) => {
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
        company_id: companyId,
        source_account_id: virmanForm.source_account_id,
        target_account_id: virmanForm.target_account_id,
        amount: Number(virmanForm.amount),
        description: virmanForm.description,
        via_customer_card: Boolean(virmanForm.via_customer_card),
      });
      if (res.data?.status === "pending_approval") toast.success(res.data.message);
      else toast.success(res.data?.message || "Virman tamamlandı.");
      setModal(null);
      setVirmanForm({ ...virmanForm, amount: "", via_customer_card: false });
      await refreshAccounts();
      await bumpCash();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Virman işlemi gerçekleştirilemedi.");
    }
  };

  const savePartner = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/banking/partners`, {
        company_id: companyId,
        name: partnerForm.name,
        share_percent: Number(partnerForm.share_percent || 0),
        phone: partnerForm.phone,
        email: partnerForm.email,
        monthly_salary: Number(partnerForm.monthly_salary || 0),
        salary_start_date: partnerForm.salary_start_date || undefined,
        salary_recurring: partnerForm.salary_recurring !== false,
      });
      toast.success("Ortak eklendi."); setModal(null); setPartnerForm({ name: "", share_percent: "", phone: "", email: "", monthly_salary: "", salary_start_date: "", salary_recurring: true }); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Ortak eklenemedi."); }
  };

  const openEditPartner = (p, e) => {
    e.stopPropagation();
    setPartnerForm({
      id: p.id,
      name: p.name || "",
      share_percent: p.share_percent ?? "",
      phone: p.phone || "",
      email: p.email || "",
      monthly_salary: p.monthly_salary || "",
      salary_start_date: p.salary_start_date || todayIsoDate(),
      salary_recurring: p.salary_recurring !== false,
    });
    setModal("edit");
  };

  const openSalary = (p, e) => {
    e.stopPropagation();
    setPartnerForm({
      id: p.id,
      name: p.name || "",
      monthly_salary: p.monthly_salary || "",
      salary_start_date: p.salary_start_date || todayIsoDate(),
      salary_recurring: p.salary_recurring !== false,
    });
    setModal("salary");
  };

  const saveSalary = async (e) => {
    e.preventDefault();
    try {
      const r = await axios.put(`${API_URL}/banking/partners/${partnerForm.id}`, {
        monthly_salary: Number(partnerForm.monthly_salary || 0),
        salary_start_date: partnerForm.salary_start_date || todayIsoDate(),
        salary_recurring: partnerForm.salary_recurring !== false,
      });
      const accrual = r.data?.salary_accrual;
      toast.success(partnerSalarySaveMessage(accrual, partnerForm.salary_start_date));
      setModal(null);
      setPartnerForm({ name: "", share_percent: "", phone: "", email: "", monthly_salary: "", salary_start_date: "", salary_recurring: true });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Maaş kaydedilemedi."); }
  };

  const savePartnerEdit = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`${API_URL}/banking/partners/${partnerForm.id}`, {
        name: partnerForm.name,
        share_percent: Number(partnerForm.share_percent || 0),
        phone: partnerForm.phone,
        email: partnerForm.email,
        monthly_salary: Number(partnerForm.monthly_salary || 0),
        salary_start_date: partnerForm.salary_start_date || undefined,
        salary_recurring: partnerForm.salary_recurring !== false,
      });
      toast.success("Ortak güncellendi.");
      setModal(null);
      setPartnerForm({ name: "", share_percent: "", phone: "", email: "", monthly_salary: "", salary_start_date: "", salary_recurring: true });
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Ortak güncellenemedi."); }
  };

  const saveTx = async (e) => {
    e.preventDefault();
    try {
      const ledger = isPartnerLedgerType(txForm.type);
      const payload = {
        ...txForm,
        amount: Number(txForm.amount),
        account_id: ledger ? null : (txForm.account_id || firstAcc),
      };
      if (!ledger && !payload.account_id) {
        toast.error("Kasa veya banka hesabı seçin.");
        return;
      }
      const res = await axios.post(`${API_URL}/banking/partners/transactions`, payload);
      if (res.data?.status === "pending_approval") {
        toast.success(res.data.message);
      } else {
        toast.success(`${TX_LABEL[txForm.type] || "İşlem"} kaydedildi.`);
      }
      setModal(null); setTxForm({ ...txForm, amount: "", description: "" }); load(); await bumpCash();
    } catch (err) { toast.error(err.response?.data?.detail || "İşlem kaydedilemedi."); }
  };

  const removePartner = async (id) => {
    try { await axios.delete(`${API_URL}/banking/partners/${id}`); toast.success("Ortak silindi."); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Ortak silinemedi."); }
  };

  const uploadPartnerPhoto = async (partnerId, ev) => {
    const raw = ev.target.files?.[0];
    ev.target.value = "";
    if (!raw || !partnerId) return;
    try {
      const file = await compressImageFile(raw);
      const fd = new FormData();
      fd.append("file", file);
      const r = await axios.post(
        `${API_URL}/files/upload?entity=partner_photo&entity_id=${encodeURIComponent(partnerId)}&company_id=${encodeURIComponent(companyId || "")}`,
        fd,
      );
      toast.success(r.data?.saved_pct ? `Fotoğraf yüklendi (≈%${r.data.saved_pct} küçültüldü).` : "Fotoğraf yüklendi.");
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Fotoğraf yüklenemedi.");
    }
  };

  return (
    <div className="space-y-5" data-testid="partners-panel">
      <CashApprovalsBanner companyId={companyId} refreshKey={`${partners.length}-${txs[0]?.id || ""}-${modal || ""}`} onChanged={() => { load(); bumpCash(); }} />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600"><Users className="w-5 h-5" /></div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Ortaklar Hesabı</h2>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={openTxModal} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="partner-tx-btn"><ArrowDownRight className="w-4 h-4" /> Para Giriş / Çıkış</button>
          <button onClick={openVirmanModal} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="partner-virman-btn"><ArrowLeftRight className="w-4 h-4" /> Virman</button>
          <button onClick={() => { setPartnerForm({ name: "", share_percent: "", phone: "", email: "", monthly_salary: "", salary_start_date: todayIsoDate(), salary_recurring: true }); setModal("add"); }} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-xl text-xs font-semibold" data-testid="add-partner-btn"><Plus className="w-4 h-4" /> Ortak Ekle</button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          {(() => {
            // Net = tüm ortakların kart tutarı (Giriş+Çıkış); hareket yoksa kayıtlı bakiye
            let cashNet = 0;
            let usedCash = false;
            for (const p of partners) {
              const br = partnerLedgers[p.id];
              if (br && br.count > 0) {
                cashNet += br.cardDisplay;
                usedCash = true;
              } else {
                cashNet += partnerBalanceMeta(p.balance).display;
              }
            }
            cashNet = Math.round(cashNet * 100) / 100;
            const net = usedCash
              ? partnerBalanceMeta(-cashNet)
              : partnerBalanceMeta(summary.total_balance);
            const netAmount = usedCash ? cashNet : net.display;
            return [
              ["net", net.side === "zero" ? "Net bakiye" : `Net ${net.label}`, netAmount, net.amountCls],
              ["capital", "Toplam Giriş", summary.total_capital_in, "text-emerald-700"],
              ["withdrawn", "Toplam Çıkış", summary.total_withdrawn, "text-rose-700"],
            ].map(([id, l, v, c]) => (
            <div key={id} className="bg-white border border-slate-200 rounded-xl p-3" data-testid={`partner-summary-${id}`}>
              <div className="text-[10px] uppercase font-semibold text-slate-400">{l}</div>
              <div className={`text-base font-bold ${c}`}>{fmt(v)} ₺</div>
            </div>
          ));
          })()}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {partners.map((p) => {
          const selected = selectedPartnerId === p.id;
          return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => selectPartner(p.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectPartner(p.id); } }}
            className={`bg-white border rounded-2xl p-4 space-y-2 shadow-sm cursor-pointer transition ${selected ? "border-amber-500 ring-2 ring-amber-200" : "border-slate-200 hover:border-slate-300"}`}
            data-testid={`partner-card-${p.name}`}
            aria-pressed={selected}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <label
                  className="relative w-12 h-12 rounded-full shrink-0 cursor-pointer group"
                  title="Fotoğraf yükle"
                  data-testid={`partner-photo-${p.id}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {p.photo_url ? (
                    <img src={resolveImageUrl(p.photo_url)} alt="" className="w-12 h-12 rounded-full object-cover bg-white border border-slate-200" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-amber-500 text-white flex items-center justify-center font-black text-sm">{(p.name || "O").slice(0, 2).toUpperCase()}</div>
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center shadow-sm group-hover:bg-slate-900">
                    <Camera className="w-3 h-3" />
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(ev) => uploadPartnerPhoto(p.id, ev)}
                    data-testid={`partner-photo-input-${p.id}`}
                  />
                </label>
                <div className="min-w-0">
                <div className="font-bold text-slate-900 text-sm">{p.name}</div>
                <div className="text-[11px] text-slate-500">{p.email || p.phone || "—"}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-md px-2 py-0.5 text-xs font-bold">%{p.share_percent}</span>
                <button type="button" onClick={(e) => openEditPartner(p, e)} className="p-1.5 text-slate-500 hover:text-indigo-600" title="Düzenle" data-testid={`edit-partner-${p.name}`}><Pencil className="w-4 h-4" /></button>
              </div>
            </div>
            {(() => {
              const br = partnerLedgers[p.id];
              // Kart = Giriş + Çıkış; rozet kasa netinden (eksi → Alacaklı)
              const bm = br && br.count > 0
                ? partnerBalanceMeta(br.cardPocket)
                : partnerBalanceMeta(p.balance);
              const amount = br && br.count > 0 ? br.cardDisplay : bm.display;
              return (
            <div className="pt-2 border-t border-slate-100 flex items-end justify-between" data-testid={`partner-balance-${p.id}`}>
              <div className="min-w-0">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${bm.badgeCls}`} data-testid={`partner-balance-badge-${p.id}`}>{bm.badge}</span>
                <div className={`text-lg font-bold ${bm.amountCls}`} data-testid={`partner-balance-amount-${p.id}`}>{fmt(amount)} ₺</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); removePartner(p.id); }} className="p-1.5 text-slate-300 hover:text-rose-600 shrink-0" title="Sil" data-testid={`delete-partner-${p.name}`}><Trash2 className="w-4 h-4" /></button>
            </div>
              );
            })()}
            <button
              type="button"
              onClick={(e) => openSalary(p, e)}
              className="w-full flex items-center justify-between gap-2 rounded-lg border border-amber-100 bg-amber-50/70 px-2.5 py-1.5 text-left hover:bg-amber-50"
              data-testid={`partner-salary-btn-${p.id}`}
            >
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-900">
                <Banknote className="w-3.5 h-3.5" /> Aylık maaş
              </span>
              <span className="text-[11px] font-bold text-amber-950" data-testid={`partner-salary-${p.id}`}>
                {partnerSalaryCardText(p, fmt)}
              </span>
            </button>
            {(() => {
              const br = partnerLedgers[p.id];
              const g = br ? br.girisDisplay : 0;
              const c = br ? br.cikisDisplay : 0;
              return (
            <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-500">
              <div>Giriş: <b className={g < 0 ? "text-rose-700" : "text-emerald-700"} data-testid={`partner-card-giris-${p.id}`}>{fmt(g)}</b></div>
              <div>Çıkış: <b className={c < 0 ? "text-rose-700" : "text-emerald-700"} data-testid={`partner-card-cikis-${p.id}`}>{c > 0 ? `+${fmt(c)}` : fmt(c)}</b></div>
            </div>
              );
            })()}
          </div>
          );
        })}
        {partners.length === 0 && <div className="col-span-full text-center text-xs text-slate-400 py-6 bg-white border border-dashed rounded-2xl">Henüz ortak tanımlanmadı.</div>}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden" data-testid="partner-tx-section">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-bold text-slate-900">
            Ortak Hareketleri
            {selectedPartner && <span className="ml-2 font-semibold text-amber-700" data-testid="partner-tx-filter-label">· {selectedPartner.name}</span>}
          </div>
          {selectedPartner && (
            <button
              type="button"
              onClick={() => setSelectedPartnerId(null)}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2 py-1"
              data-testid="partner-tx-clear-filter"
            >
              Tüm ortaklar
            </button>
          )}
        </div>
        {selectedLedger && (
          <div
            className={`px-5 py-3 border-b text-xs space-y-2 ${selectedLedger.drift ? "bg-rose-50/80 border-rose-100" : "bg-slate-50/80 border-slate-100"}`}
            data-testid="partner-ledger-check"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-bold text-slate-800">Bakiye kontrolü</div>
              <div className={selectedLedger.drift || !selectedLedger.netMatchesCard ? "text-rose-700 font-semibold" : "text-emerald-700 font-semibold"} data-testid="partner-ledger-match">
                {selectedLedger.drift
                  ? `Sapma: kayıtlı ${fmt(partnerBalanceMeta(selectedLedger.stored).display)} ₺ ≠ hareket ${fmt(selectedLedger.cardDisplay)} ₺`
                  : selectedLedger.netMatchesCard
                    ? `Kart = Giriş + Çıkış (${fmt(selectedLedger.netDisplay)} ₺ · ${selectedLedger.count} kayıt)`
                    : `Kart ${fmt(selectedLedger.cardDisplay)} ₺ · Giriş+Çıkış ${fmt(selectedLedger.netDisplay)} ₺ (${selectedLedger.count} kayıt)`}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2" data-testid="partner-ledger-buckets">
              <div className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5">
                <div className="text-[10px] uppercase text-slate-400 font-semibold">Giriş</div>
                <div className={`font-bold ${selectedLedger.girisDisplay < 0 ? "text-rose-700" : "text-emerald-700"}`} data-testid="partner-ledger-inflow">{fmt(selectedLedger.girisDisplay)} ₺</div>
              </div>
              <div className="rounded-lg border border-slate-200/80 bg-white px-2 py-1.5">
                <div className="text-[10px] uppercase text-slate-400 font-semibold">Çıkış</div>
                <div className={`font-bold ${selectedLedger.cikisDisplay < 0 ? "text-rose-700" : "text-emerald-700"}`} data-testid="partner-ledger-outflow">{selectedLedger.cikisDisplay > 0 ? `+${fmt(selectedLedger.cikisDisplay)}` : fmt(selectedLedger.cikisDisplay)} ₺</div>
              </div>
            </div>
          </div>
        )}
        <PartnerTxTable txs={visibleTxs} accounts={liveAccounts} companyId={companyId} onChanged={() => { load(); bumpCash(); }} />
      </div>

      {modal === "add" && (
        <Modal title="Yeni Ortak" onClose={() => setModal(null)} testId="add-partner-modal">
          <form onSubmit={savePartner} className="space-y-3 text-xs">
            <div><label className="block font-semibold mb-1">Ad Soyad</label><input className={inputCls} value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} required data-testid="partner-name-input" /></div>
            <div><label className="block font-semibold mb-1">Ortaklık Payı (%)</label><input type="number" step="0.01" className={inputCls} value={partnerForm.share_percent} onChange={(e) => setPartnerForm({ ...partnerForm, share_percent: e.target.value })} required data-testid="partner-share-input" />
              <p className="text-[10px] text-slate-400 mt-1">Mevcut toplam: %{summary?.total_share_percent || 0}</p></div>
            <div><label className="block font-semibold mb-1">Aylık maaş (₺)</label><input type="number" step="0.01" min="0" className={inputCls} value={partnerForm.monthly_salary} onChange={(e) => setPartnerForm({ ...partnerForm, monthly_salary: e.target.value })} data-testid="partner-salary-input" /></div>
            <div><label className="block font-semibold mb-1">Hak ediş tarihi</label><input type="date" className={inputCls} value={partnerForm.salary_start_date || ""} onChange={(e) => setPartnerForm({ ...partnerForm, salary_start_date: e.target.value })} data-testid="partner-salary-date-input" />
              <p className="text-[10px] text-slate-400 mt-1">Bu tarihte cebine yazılır. Her ay tekrarla açıksa aynı günde her ay tekrarlanır.</p></div>
            <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={partnerForm.salary_recurring !== false} onChange={(e) => setPartnerForm({ ...partnerForm, salary_recurring: e.target.checked })} data-testid="partner-salary-recurring" /> Her ay tekrarla</label>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block font-semibold mb-1">Telefon</label><input className={inputCls} value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} /></div>
              <div><label className="block font-semibold mb-1">E-posta</label><input className={inputCls} value={partnerForm.email} onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="save-partner-btn">Kaydet</button></div>
          </form>
        </Modal>
      )}

      {modal === "salary" && (
        <Modal title={`${partnerForm.name || "Ortak"} — Aylık maaş`} onClose={() => setModal(null)} testId="partner-salary-modal">
          <form onSubmit={saveSalary} className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Aylık maaş (₺)</label>
              <input type="number" step="0.01" min="0" className={`${inputCls} font-bold`} value={partnerForm.monthly_salary} onChange={(e) => setPartnerForm({ ...partnerForm, monthly_salary: e.target.value })} autoFocus data-testid="card-partner-salary-input" />
            </div>
            <div>
              <label className="block font-semibold mb-1">Hak ediş tarihi</label>
              <input type="date" required className={inputCls} value={partnerForm.salary_start_date || ""} onChange={(e) => setPartnerForm({ ...partnerForm, salary_start_date: e.target.value })} data-testid="card-partner-salary-date-input" />
              <p className="text-[11px] text-slate-500 mt-1">Bu tarihte cebine yazılır; tarih gelmeden bakiye değişmez.</p>
            </div>
            <label className="flex items-start gap-2 text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={partnerForm.salary_recurring !== false} onChange={(e) => setPartnerForm({ ...partnerForm, salary_recurring: e.target.checked })} data-testid="card-partner-salary-recurring" />
              <span>Her ay tekrarla <span className="text-slate-500 font-normal">(aynı günde otomatik cebine yazılır)</span></span>
            </label>
            <p className="text-[11px] text-slate-500">Kasa ve banka değişmez; ödeme istediğinizde çıkış (para çek) yaparsınız.</p>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-amber-600 text-white rounded-lg font-semibold" data-testid="save-partner-salary-btn">Kaydet</button></div>
          </form>
        </Modal>
      )}

      {modal === "edit" && (
        <Modal title="Ortağı Düzenle" onClose={() => setModal(null)} testId="edit-partner-modal">
          <form onSubmit={savePartnerEdit} className="space-y-3 text-xs">
            <div><label className="block font-semibold mb-1">Ad Soyad</label><input className={inputCls} value={partnerForm.name} onChange={(e) => setPartnerForm({ ...partnerForm, name: e.target.value })} required data-testid="edit-partner-name-input" /></div>
            <div><label className="block font-semibold mb-1">Ortaklık Payı (%)</label><input type="number" step="0.01" className={inputCls} value={partnerForm.share_percent} onChange={(e) => setPartnerForm({ ...partnerForm, share_percent: e.target.value })} required data-testid="edit-partner-share-input" /></div>
            <div><label className="block font-semibold mb-1">Aylık maaş (₺)</label><input type="number" step="0.01" min="0" className={inputCls} value={partnerForm.monthly_salary} onChange={(e) => setPartnerForm({ ...partnerForm, monthly_salary: e.target.value })} data-testid="edit-partner-salary-input" /></div>
            <div><label className="block font-semibold mb-1">Hak ediş tarihi</label><input type="date" className={inputCls} value={partnerForm.salary_start_date || ""} onChange={(e) => setPartnerForm({ ...partnerForm, salary_start_date: e.target.value })} data-testid="edit-partner-salary-date-input" /></div>
            <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={partnerForm.salary_recurring !== false} onChange={(e) => setPartnerForm({ ...partnerForm, salary_recurring: e.target.checked })} data-testid="edit-partner-salary-recurring" /> Her ay tekrarla</label>
            <p className="text-[10px] text-slate-400">Hak ediş tarihi gelince cebine yazılır; geçmiş vadeler varsa o anda eklenir.</p>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block font-semibold mb-1">Telefon</label><input className={inputCls} value={partnerForm.phone} onChange={(e) => setPartnerForm({ ...partnerForm, phone: e.target.value })} /></div>
              <div><label className="block font-semibold mb-1">E-posta</label><input className={inputCls} value={partnerForm.email} onChange={(e) => setPartnerForm({ ...partnerForm, email: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold" data-testid="save-edit-partner-btn">Kaydet</button></div>
          </form>
        </Modal>
      )}

      {modal === "tx" && (
        <Modal title="Ortak Para Giriş / Çıkış" onClose={() => setModal(null)} testId="partner-tx-modal">
          <form onSubmit={saveTx} className="space-y-3 text-xs">
            <div><label className="block font-semibold mb-1">Ortak</label><select className={inputCls} value={txForm.partner_id} onChange={(e) => setTxForm({ ...txForm, partner_id: e.target.value })} data-testid="partner-tx-partner-select">{partners.map((p) => <option key={p.id} value={p.id}>{p.name} (%{p.share_percent})</option>)}</select></div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setTxForm({ ...txForm, type: "capital_in" })} className={`p-2 rounded-lg border font-semibold flex items-center justify-center gap-1 ${txForm.type === "capital_in" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white"}`} data-testid="partner-tx-type-in"><ArrowDownRight className="w-4 h-4" /> Para Koy</button>
              <button type="button" onClick={() => setTxForm({ ...txForm, type: "withdrawal" })} className={`p-2 rounded-lg border font-semibold flex items-center justify-center gap-1 ${txForm.type === "withdrawal" ? "bg-rose-600 text-white border-rose-600" : "bg-white"}`} data-testid="partner-tx-type-out"><ArrowUpRight className="w-4 h-4" /> Para Çek</button>
              <button type="button" onClick={() => setTxForm({ ...txForm, type: "credit", account_id: "" })} className={`p-2 rounded-lg border font-semibold flex items-center justify-center gap-1 ${txForm.type === "credit" ? "bg-rose-700 text-white border-rose-700" : "bg-white"}`} data-testid="partner-tx-type-credit" title="Ortak alacak fişi — listede Çıkış (−) görünür">Alacaklandır</button>
              <button type="button" onClick={() => setTxForm({ ...txForm, type: "debit", account_id: "" })} className={`p-2 rounded-lg border font-semibold flex items-center justify-center gap-1 ${txForm.type === "debit" ? "bg-rose-700 text-white border-rose-700" : "bg-white"}`} data-testid="partner-tx-type-debit" title="Kasa/bankaya dokunmadan ortak bakiyesini düşürür">Borçlandır</button>
            </div>
            {isPartnerCashType(txForm.type) ? (
              <div><label className="block font-semibold mb-1">{txForm.type === "capital_in" ? "Kasa / Banka Hesabı" : "Kasa / Banka / Kart"}</label><PaymentTargetSelect companyId={companyId} accounts={liveAccounts} value={txForm.account_id} onChange={(v) => setTxForm({ ...txForm, account_id: v })} testId="partner-tx-account-select" includePartners={false} collectableOnly={txForm.type === "capital_in"} disabled={accountsLoading} emptyLabel={accountsLoading ? "Hesaplar yükleniyor…" : undefined} className={inputCls} /></div>
            ) : (
              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2" data-testid="partner-tx-ledger-hint">
                {txForm.type === "credit" ? "Alacak fişi ortak alacağını artırır; listede Çıkış (−) / kasa eksi görünür." : "Borç fişi ortak bakiyesini düşürür (Çıkış)." }
                {" "}Kasa/banka bakiyesi değişmez. Firma politikası açıksa diğer yöneticinin onayı gerekir.
              </p>
            )}
            <div><label className="block font-semibold mb-1">Tutar (₺)</label><input type="number" step="0.01" className={`${inputCls} font-bold`} value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} required data-testid="partner-tx-amount-input" /></div>
            <div><label className="block font-semibold mb-1">Açıklama</label><input className={inputCls} value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} placeholder={isPartnerLedgerType(txForm.type) ? "Örn: Açılış bakiyesi / düzeltme" : "Örn: Sermaye artırımı"} /></div>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold" data-testid="save-partner-tx-btn">İşlemi Kaydet</button></div>
          </form>
        </Modal>
      )}


      {modal === "virman" && (
        <Modal title="Hesaplar Arası Virman" onClose={() => setModal(null)} testId="partner-virman-modal">
          <form onSubmit={saveVirman} className="space-y-3 text-xs">
            <p className="text-[11px] text-slate-500">Kasa, banka, POS, kredi kartı, ortak veya cari arasında transfer. Kaynak/hedef için hesap veya cari ayrı seçilir; cari arama ile bulunur. Hesap→ortak para çekişi, ortak→hesap sermaye girişi; entegre hesaplar listelenmez.</p>
            <VirmanPartySelect
              companyId={companyId}
              accounts={liveAccounts}
              value={virmanForm.source_account_id}
              onChange={(v) => setVirmanForm({ ...virmanForm, source_account_id: v, via_customer_card: String(v || "").startsWith("contact:") || String(virmanForm.target_account_id || "").startsWith("contact:") ? virmanForm.via_customer_card : false })}
              testId="partner-virman-source"
              label="Kaynak (Çıkış)"
              includePartners
              excludeIntegrated
              disabled={accountsLoading}
              emptyLabel={accountsLoading ? "Hesaplar yükleniyor…" : undefined}
            />
            <VirmanPartySelect
              companyId={companyId}
              accounts={liveAccounts}
              value={virmanForm.target_account_id}
              onChange={(v) => setVirmanForm({ ...virmanForm, target_account_id: v, via_customer_card: String(virmanForm.source_account_id || "").startsWith("contact:") || String(v || "").startsWith("contact:") ? virmanForm.via_customer_card : false })}
              testId="partner-virman-target"
              label="Hedef (Giriş)"
              includePartners
              excludeIntegrated
              disabled={accountsLoading}
              emptyLabel={accountsLoading ? "Hesaplar yükleniyor…" : undefined}
            />
            {(String(virmanForm.source_account_id || "").startsWith("contact:") || String(virmanForm.target_account_id || "").startsWith("contact:")) && (
              <label className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-3 cursor-pointer" data-testid="partner-virman-via-customer-card">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={Boolean(virmanForm.via_customer_card)}
                  onChange={(e) => setVirmanForm({ ...virmanForm, via_customer_card: e.target.checked })}
                  data-testid="partner-virman-via-customer-card-input"
                />
                <span>
                  <span className="font-semibold text-rose-900">Müşteri kredi kartı ile virman yapıldı</span>
                  <span className="block text-[11px] text-rose-800/90 mt-0.5">Hareket Müşteri Kredi Kartları kasasında listelenir.</span>
                </span>
              </label>
            )}
            <div><label className="block font-semibold mb-1">Tutar (₺)</label><input type="number" step="0.01" className={`${inputCls} font-bold`} value={virmanForm.amount} onChange={(e) => setVirmanForm({ ...virmanForm, amount: e.target.value })} required data-testid="partner-virman-amount" /></div>
            <div><label className="block font-semibold mb-1">Açıklama</label><input className={inputCls} value={virmanForm.description} onChange={(e) => setVirmanForm({ ...virmanForm, description: e.target.value })} data-testid="partner-virman-desc" /></div>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setModal(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" disabled={accountsLoading || !virmanForm.source_account_id || !virmanForm.target_account_id || virmanForm.source_account_id === virmanForm.target_account_id} className="px-4 py-1.5 bg-slate-800 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="partner-virman-submit">Virmanı Onayla</button></div>
          </form>
        </Modal>
      )}

    </div>
  );
};
