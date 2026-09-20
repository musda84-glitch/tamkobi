import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { FileSignature, Briefcase, Ruler, Plus, Trash2, ImagePlus, FileText, Printer, ArrowRight, X, Receipt, Users, Pencil, CheckCircle2, Check, CalendarClock } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { SearchSelect } from "../components/SearchSelect";
import { DocumentLineEditor, LineTotalsFooter } from "../components/DocumentLineEditor";
import { PrintDocument, PrintTemplateEditor } from "../components/PrintDocument";
import { InstallmentPlanModal } from "../components/InstallmentPlanModal";
import { QuoteSendApprovalModal, ApprovalBadge } from "../components/QuoteSendApprovalModal";
import { ProjectTrackingModal, TrackingBadge } from "../components/ProjectTrackingModal";
import { ProjectExpenseModal, ProjectTeamTasksModal } from "../components/ProjectExpenseTeamModals";
import { MapPin, LocateFixed, Link2 } from "lucide-react";
import { compressImageFile } from "../utils/compressImage";
import { HoverImageThumb } from "../utils/HoverImageThumb";
import { computeLine, documentLineTotals, emptyLine, hydrateLine } from "../utils/documentLines";
import { DEFAULT_PROJECT_STAGES, normalizeProjectStages, projectStageMap, finalProjectStageKey } from "../utils/projectStages";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2";
const STATUS = { draft: ["Taslak", "bg-slate-100 text-slate-600"], sent: ["Gönderildi", "bg-blue-50 text-blue-700"], accepted: ["Kabul / Faturalandı", "bg-emerald-50 text-emerald-700"], rejected: ["Reddedildi", "bg-rose-50 text-rose-700"], planning: ["Planlama", "bg-slate-100 text-slate-600"], active: ["Devam Ediyor", "bg-blue-50 text-blue-700"], completed: ["Tamamlandı", "bg-emerald-50 text-emerald-700"], on_hold: ["Beklemede", "bg-amber-50 text-amber-700"], planned: ["Planlandı", "bg-slate-100 text-slate-600"], done: ["Yapıldı", "bg-blue-50 text-blue-700"], quoted: ["Teklife Dönüştü", "bg-emerald-50 text-emerald-700"] };
const Badge = ({ s, map }) => { const [l, c] = (map && map[s]) || STATUS[s] || [s, "bg-slate-100"]; return <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${c}`}>{l}</span>; };

const SURVEY_STATUS_ICON = {
  planned: { Icon: CalendarClock, tip: "Planlandı", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  done: { Icon: Check, tip: "Yapıldı", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  quoted: { Icon: FileSignature, tip: "Teklife dönüştü", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

/** Keşif satırı: durum + aksiyonlar ikon toolbar. */
const SurveyActions = ({ s, onDone, onToQuote, onDelete, dense = false }) => {
  const st = SURVEY_STATUS_ICON[s.status] || { Icon: Ruler, tip: STATUS[s.status]?.[0] || s.status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
  const StatusIcon = st.Icon;
  const btn = dense ? "p-1.5" : "p-2";
  return (
    <div className="flex items-center justify-end gap-1 flex-wrap" data-testid={`survey-actions-${s.survey_number}`}>
      <span
        className={`inline-flex items-center justify-center ${btn} rounded-lg border ${st.cls}`}
        title={st.tip}
        aria-label={st.tip}
        data-testid={`survey-status-icon-${s.survey_number}`}
      >
        <StatusIcon className="w-4 h-4" />
      </span>
      {s.status === "planned" && (
        <button
          type="button"
          onClick={onDone}
          className={`inline-flex items-center justify-center ${btn} rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-emerald-700`}
          title="Yapıldı olarak işaretle"
          data-testid={`survey-done-${s.survey_number}`}
        >
          <CheckCircle2 className="w-4 h-4" />
        </button>
      )}
      {!s.quote_id && (
        <button
          type="button"
          onClick={onToQuote}
          className={`inline-flex items-center justify-center gap-1 ${dense ? "px-2 py-1.5" : "px-2.5 py-2"} rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold`}
          title="Teklife çevir"
          data-testid={`survey-to-quote-${s.survey_number}`}
        >
          <FileSignature className="w-4 h-4" />
          <ArrowRight className="w-3 h-3 opacity-80" />
        </button>
      )}
      {s.quote_id && (
        <span
          className={`inline-flex items-center justify-center ${btn} rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700`}
          title="Teklife bağlı"
          data-testid={`survey-quoted-${s.survey_number}`}
        >
          <FileText className="w-4 h-4" />
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        className={`inline-flex items-center justify-center ${btn} text-slate-300 hover:text-rose-600 rounded-lg`}
        title="Sil"
        data-testid={`survey-del-${s.survey_number}`}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};

const ImageStrip = ({ entity, doc, onUpdated }) => {
  const [busy, setBusy] = useState(false);
  const docId = doc?.id || doc?._id;
  const upload = async (e) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw || !docId) { toast.error("Önce kaydı oluşturun, sonra görsel ekleyin."); return; }
    const f = await compressImageFile(raw);
    const fd = new FormData();
    fd.append("file", f);
    setBusy(true);
    try {
      await axios.post(
        `${API_URL}/files/upload?entity=${entity}&entity_id=${docId}&company_id=${doc.company_id || ""}`,
        fd,
      );
      toast.success("Görsel yüklendi.");
      onUpdated?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Yüklenemedi.");
    } finally {
      setBusy(false);
    }
  };
  const imgs = doc.images || [];
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid={`${entity}-images-${docId}`}>
      {imgs.map((img) => (
        <HoverImageThumb key={img} src={img} className="w-10 h-10 rounded-lg object-cover border" testId={`${entity}-thumb-${docId}`} />
      ))}
      <label className={`w-10 h-10 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer shrink-0 ${busy ? "opacity-50 border-slate-200" : "border-slate-300 hover:border-emerald-500 text-slate-400"}`} title="Görsel ekle">
        {busy ? <span className="text-[9px]">…</span> : <ImagePlus className="w-4 h-4" />}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.pdf" capture="environment" className="hidden" onChange={upload} disabled={busy} data-testid={`${entity}-upload-${docId}`} />
      </label>
    </div>
  );
};

const toQuoteLinePayload = (it) => {
  const line = computeLine(it);
  return {
    product_id: line.product_id || "",
    name: line.name || line.product_name || "",
    sku: line.sku || "",
    quantity: Number(line.quantity) || 0,
    unit: line.unit || "Adet",
    unit_price: Number(line.unit_price) || 0,
    unit_price_incl: Number(line.unit_price_incl) || 0,
    vat_rate: Number(line.vat_rate) || 0,
    discount_rate: Number(line.discount_rate) || 0,
    total: Number(line.total) || 0,
    total_incl: Number(line.total_incl) || 0,
    vat_amount: Number(line.vat_amount) || 0,
    is_service: !!line.is_service,
  };
};

const FILTER_KEY = "tamkobi_qp_only_pending";

export default function ProjectsPage({ section } = {}) {
  const { activeCompany, loading: authLoading } = useAuth();
  const location = useLocation();
  const companyId = activeCompany?.id || activeCompany?._id || (!authLoading ? "comp_nexus_main_01" : "");
  const pathTab = section || (location.pathname.includes("/surveys") ? "surveys" : location.pathname.includes("/projects") && !location.pathname.includes("/quotes") ? "projects" : "quotes");
  const [tab, setTab] = useState(pathTab);
  useEffect(() => { setTab(pathTab); }, [pathTab]);
  const [quotes, setQuotes] = useState([]); const [projects, setProjects] = useState([]); const [surveys, setSurveys] = useState([]);
  const [contacts, setContacts] = useState([]); const [products, setProducts] = useState([]);
  const [refsReady, setRefsReady] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [items, setItems] = useState([]);
  const [printDoc, setPrintDoc] = useState(null);
  const [planQuote, setPlanQuote] = useState(null);
  const [approvalQuote, setApprovalQuote] = useState(null);
  const [trackingProject, setTrackingProject] = useState(null);
  const [expenseProject, setExpenseProject] = useState(null);
  const [teamProject, setTeamProject] = useState(null);
  const [projectStages, setProjectStages] = useState(DEFAULT_PROJECT_STAGES);
  const [editTpl, setEditTpl] = useState(false);
  const parseLoc = (v) => { const m = v.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || v.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/) || v.match(/(-?\d{1,2}\.\d{4,})[,\s]+(-?\d{1,3}\.\d{4,})/); return m ? { latitude: parseFloat(m[1]), longitude: parseFloat(m[2]) } : {}; };
  const useMyLocation = () => { if (!navigator.geolocation) { toast.error("Tarayıcı konum desteklemiyor."); return; } navigator.geolocation.getCurrentPosition((p) => { const lat = p.coords.latitude.toFixed(6), lng = p.coords.longitude.toFixed(6); setForm((f) => ({ ...f, latitude: Number(lat), longitude: Number(lng), location_url: `https://www.google.com/maps?q=${lat},${lng}` })); toast.success("Mevcut konum alındı."); }, () => toast.error("Konum alınamadı.")); };

  // Liste: sadece özet uçlar — contacts/products açılışta çekilmez (en büyük yavaşlık kaynağı).
  const load = useCallback(async () => {
    if (!companyId) return;
    setListLoading(true);
    try {
      const [q, p, s, st] = await Promise.all([
        axios.get(`${API_URL}/quotes?company_id=${companyId}&summary=1`),
        axios.get(`${API_URL}/projects?company_id=${companyId}&light=1`),
        axios.get(`${API_URL}/surveys?company_id=${companyId}`),
        axios.get(`${API_URL}/companies/${companyId}/project-stages`).catch(() => ({ data: { stages: DEFAULT_PROJECT_STAGES } })),
      ]);
      setQuotes(q.data || []); setProjects(p.data || []); setSurveys(s.data || []);
      setProjectStages(normalizeProjectStages(st.data?.stages));
    } finally {
      setListLoading(false);
    }
  }, [companyId]);
  const projectStatusMap = projectStageMap(projectStages);
  const finalStage = finalProjectStageKey(projectStages);
  useEffect(() => {
    if (authLoading || !companyId) return;
    load().catch(() => { setListLoading(false); toast.error("Veriler yüklenemedi."); });
  }, [load, authLoading, companyId]);

  const ensureFormRefs = useCallback(async () => {
    if (refsReady || !companyId) return;
    try {
      const [c, pr] = await Promise.all([
        axios.get(`${API_URL}/contacts?company_id=${companyId}&lite=1`),
        axios.get(`${API_URL}/products?company_id=${companyId}&lite=1`),
      ]);
      setContacts(c.data || []); setProducts(pr.data || []); setRefsReady(true);
    } catch {
      toast.error("Cari / ürün listesi yüklenemedi.");
    }
  }, [companyId, refsReady]);

  const ensureContacts = useCallback(async () => {
    if (contacts.length || !companyId) return contacts;
    try {
      const c = await axios.get(`${API_URL}/contacts?company_id=${companyId}&lite=1`);
      setContacts(c.data || []);
      return c.data || [];
    } catch {
      return contacts;
    }
  }, [companyId, contacts]);

  const openPrintQuote = async (q) => {
    try {
      const r = await axios.get(`${API_URL}/quotes/${q.id}`);
      setPrintDoc({ type: "quote", doc: r.data });
    } catch {
      setPrintDoc({ type: "quote", doc: q });
    }
  };
  const openApproval = async (q) => { await ensureContacts(); setApprovalQuote(q); };
  const openTracking = async (p) => { await ensureContacts(); setTrackingProject(p); };

  const openForm = (kind) => {
    setForm({ kind, contact_id: "", contact_name: "", title: "", name: "", valid_until: "", notes: "", address: "", budget: "", start_date: "", end_date: "", survey_date: new Date().toISOString().slice(0, 10), measurements: [] });
    setItems([computeLine(emptyLine())]);
    ensureFormRefs();
  };
  const openEditQuote = async (q) => {
    await ensureFormRefs();
    try {
      const r = await axios.get(`${API_URL}/quotes/${q.id}`);
      const full = r.data || q;
      setForm({
        id: full.id,
        kind: "quote",
        contact_id: full.contact_id || "",
        contact_name: full.contact_name || "",
        title: full.title || "",
        name: "",
        valid_until: full.valid_until || "",
        notes: full.notes || "",
        address: full.address || "",
        budget: "",
        start_date: "",
        end_date: "",
        survey_date: "",
        measurements: [],
        project_id: full.project_id || "",
      });
      const its = (full.items || []).filter((i) => i?.name || i?.product_name);
      setItems(its.length ? its.map((i) => hydrateLine(i)) : [computeLine(emptyLine())]);
    } catch {
      toast.error("Teklif yüklenemedi.");
    }
  };
  const lineTotals = useMemo(() => documentLineTotals(items), [items]);
  const setContact = (id, c) => setForm({ ...form, contact_id: id, contact_name: c?.name || "", address: form.address || c?.address || "" });
  const [newContact, setNewContact] = useState(null);
  const createContact = async (e) => {
    e.preventDefault();
    try {
      const r = await axios.post(`${API_URL}/contacts`, { company_id: companyId, type: "customer", name: newContact.name, tax_number_or_id: newContact.tax || "", phone: newContact.phone || "", email: newContact.email || "", address: newContact.address || "", city: "İstanbul", category: "Genel" });
      setContacts((cs) => [...cs, r.data]); setContact(r.data.id, r.data); setNewContact(null); toast.success("Yeni cari oluşturuldu.");
    } catch (err) { toast.error(err.response?.data?.detail || "Cari oluşturulamadı."); }
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      const lineItems = items
        .map((i) => toQuoteLinePayload(i))
        .filter((i) => (i.name || "").trim() && Number(i.quantity) > 0);
      if (form.kind === "quote") {
        if (!lineItems.length) { toast.error("En az bir kalem ekleyin."); return; }
        if (form.id) {
          await axios.put(`${API_URL}/quotes/${form.id}`, {
            title: form.title,
            contact_id: form.contact_id,
            contact_name: form.contact_name,
            valid_until: form.valid_until,
            notes: form.notes,
            project_id: form.project_id || undefined,
            items: lineItems,
          });
        } else {
          await axios.post(`${API_URL}/quotes`, { company_id: companyId, ...form, items: lineItems });
        }
      } else if (form.kind === "project") await axios.post(`${API_URL}/projects`, { company_id: companyId, ...form, budget: Number(form.budget || 0) });
      else await axios.post(`${API_URL}/surveys`, {
        company_id: companyId,
        ...form,
        measurements: lineItems.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unit: i.unit,
          unit_price: i.unit_price,
          vat_rate: i.vat_rate,
          discount_rate: i.discount_rate,
          product_id: i.product_id || undefined,
        })),
      });
      toast.success(form.id ? "Güncellendi." : "Kaydedildi."); setForm(null); load();
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); }
  };

  const act = async (fn, msg) => { try { const r = await fn(); toast.success(r?.data?.message || msg); load(); } catch (err) { toast.error(err.response?.data?.detail || "İşlem başarısız."); } };
  const advanceFromSurvey = async (surveyId) => {
    if (!window.confirm("Keşif tamamlandı. Teklife dönüştürülsün mü? (İptal = sadece durum güncellenir; teklifi sonra da ayrı oluşturabilirsiniz.)")) return;
    await act(() => axios.post(`${API_URL}/surveys/${surveyId}/convert-to-quote`), "Teklif oluşturuldu.");
    setTab("quotes");
  };
  const advanceFromQuote = async (quoteId) => {
    if (!window.confirm("Teklif kabul / tamam. Projeye dönüştürülsün mü? (İptal = sadece durum; projeyi sonra ayrı oluşturabilirsiniz.)")) return;
    await act(() => axios.post(`${API_URL}/quotes/${quoteId}/convert-to-project`), "Proje oluşturuldu.");
    setTab("projects");
  };
  const setStatus = async (coll, id, status) => {
    await act(() => axios.put(`${API_URL}/${coll}/${id}`, { status }), "Durum güncellendi.");
    if (coll === "surveys" && status === "done") {
      const s = surveys.find((x) => x.id === id);
      if (s && !s.quote_id) await advanceFromSurvey(id);
    }
    if (coll === "quotes" && status === "accepted") {
      const q = quotes.find((x) => x.id === id);
      if (q && !q.project_id) await advanceFromQuote(id);
    }
  };
  const del = (coll, id) => act(() => axios.delete(`${API_URL}/${coll}/${id}`), "Silindi.");

  // Varsayılan: tüm kayıtlar görünür (yenilemede "kayboldu" hissi olmasın).
  const [onlyPending, setOnlyPending] = useState(() => {
    try { return sessionStorage.getItem(FILTER_KEY) === "1"; } catch { return false; }
  });
  const toggleOnlyPending = (on) => {
    setOnlyPending(on);
    try { sessionStorage.setItem(FILTER_KEY, on ? "1" : "0"); } catch { /* ignore */ }
  };
  const pendingQuotes = quotes.filter((q) => q.status === "draft" || (q.status === "sent" && (!q.approval || q.approval.status === "pending")) || (q.status === "accepted" && !q.project_id && !q.invoice_id));
  const pendingSurveys = surveys.filter((s) => s.status === "planned" || (s.status === "done" && !s.quote_id));
  const visibleQuotes = onlyPending ? pendingQuotes : quotes;
  const visibleSurveys = onlyPending ? pendingSurveys : surveys;
  const hiddenCount = tab === "quotes" ? quotes.length - pendingQuotes.length : tab === "surveys" ? surveys.length - pendingSurveys.length : 0;
  const TABS = [["quotes", "Teklifler", FileSignature, visibleQuotes.length], ["projects", "Projeler", Briefcase, projects.length], ["surveys", "Keşifler", Ruler, visibleSurveys.length]];
  const kind = tab === "quotes" ? "quote" : tab === "projects" ? "project" : "survey";

  return (
    <div className="space-y-6" data-testid="projects-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Teklif / Proje / Keşif</h1><p className="text-xs sm:text-sm text-slate-500">Tamamlanan aşama bir sonrakine geçebilir; proje aşamalarını müşteriye SMS / e-posta / WhatsApp linkiyle paylaşın</p></div>
        <button onClick={() => openForm(kind)} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs font-semibold" data-testid={`new-${kind}-btn`}><Plus className="w-4 h-4" /> {kind === "quote" ? "Yeni Teklif" : kind === "project" ? "Yeni Proje" : "Yeni Keşif"}</button>
      </div>
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">{TABS.map(([k, l, Icon, n]) => <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`} data-testid={`projects-tab-${k}`}><Icon className="w-3.5 h-3.5" /> {l} <span className="text-slate-400">({n})</span></button>)}
        {tab !== "projects" && (
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500 pb-1 cursor-pointer" data-testid="only-pending-toggle">
            <input type="checkbox" checked={onlyPending} onChange={(e) => toggleOnlyPending(e.target.checked)} className="rounded" />
            Sadece bekleyenler {hiddenCount > 0 ? `(${hiddenCount} gizli)` : ""}
          </label>
        )}
      </div>
      {tab !== "projects" && onlyPending && hiddenCount > 0 && <p className="text-[11px] text-slate-400 -mt-3" data-testid="archived-hint">{hiddenCount} kayıt filtrelendi — gönderilen teklifler ve yapılan keşifler listede gizli; filtreyi kapatınca görünür.</p>}

      {listLoading && (
        <div className="text-center text-xs text-slate-500 py-10 bg-white border border-dashed rounded-2xl" data-testid="projects-loading">Yükleniyor…</div>
      )}

      {!listLoading && tab === "quotes" && (
        <>
          {visibleQuotes.length === 0 && <div className="text-center text-xs text-slate-400 py-8 bg-white border border-dashed rounded-2xl">{onlyPending && quotes.length ? "Bekleyen teklif yok — filtreyi kapatarak tümünü görebilirsiniz." : "Henüz teklif yok."}</div>}
          <div className="md:hidden space-y-3">
            {visibleQuotes.map((q) => (
              <div key={q.id} className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2 text-xs" data-testid={`quote-row-${q.quote_number}`}>
                <div className="flex justify-between gap-2 items-start">
                  <div className="min-w-0"><div className="font-mono font-bold text-slate-900">{q.quote_number}</div><div className="text-slate-500 truncate">{q.title} • {q.issue_date}</div><div className="font-semibold mt-0.5">{q.contact_name || "—"}</div></div>
                  <div className="text-right shrink-0"><div className="font-bold">{fmt(q.grand_total)} ₺</div><Badge s={q.status} /></div>
                </div>
                <ImageStrip entity="quote" doc={q} onUpdated={load} />
                <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                  <button onClick={() => openPrintQuote(q)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg" title="Yazdır"><Printer className="w-4 h-4" /></button>
                  <button onClick={() => openEditQuote(q)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg" title="Düzenle" data-testid={`edit-quote-${q.quote_number}`}><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => openApproval(q)} className={`px-2.5 py-1.5 rounded-lg font-semibold ${q.approval?.status === "accepted" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-900 text-white"}`}>{q.approval ? "Onay" : "Onaya Gönder"}</button>
                  <button onClick={() => setPlanQuote(q)} className="px-2.5 py-1.5 border rounded-lg font-semibold text-slate-600">Ödeme Planı</button>
                  {q.status === "draft" && <button onClick={() => setStatus("quotes", q.id, "sent")} className="px-2.5 py-1.5 border rounded-lg font-semibold">Gönderildi</button>}
                  {!q.project_id && <button onClick={() => advanceFromQuote(q.id)} className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 text-white rounded-lg font-semibold"><Briefcase className="w-3 h-3" /> Projeye</button>}
                  {!q.invoice_id && <button onClick={() => act(() => axios.post(`${API_URL}/quotes/${q.id}/convert-to-invoice`, {}), "Fatura oluşturuldu.")} className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold"><FileText className="w-3 h-3" /> Fatura</button>}
                  {!q.invoice_id && <button onClick={() => setStatus("quotes", q.id, "rejected")} className="px-2.5 py-1.5 border rounded-lg text-rose-600">Red</button>}
                  <button onClick={() => del("quotes", q.id)} className="p-2 text-slate-300 hover:text-rose-600 ml-auto"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-x-auto"><table className="min-w-[720px] w-full text-left text-xs">
            <thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold"><tr><th className="px-4 py-2">Teklif</th><th className="px-4 py-2">Cari</th><th className="px-4 py-2">Görseller</th><th className="px-4 py-2 text-right">Tutar</th><th className="px-4 py-2">Durum</th><th className="px-4 py-2"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleQuotes.map((q) => (
                <tr key={q.id} data-testid={`quote-row-desk-${q.quote_number}`}>
                  <td className="px-4 py-2"><div className="font-mono font-bold text-slate-900">{q.quote_number}</div><div className="text-slate-500">{q.title} • {q.issue_date}{q.valid_until && ` → ${q.valid_until}`}</div></td>
                  <td className="px-4 py-2 font-semibold">{q.contact_name || "—"}</td>
                  <td className="px-4 py-2"><ImageStrip entity="quote" doc={q} onUpdated={load} /></td>
                  <td className="px-4 py-2 text-right font-bold">{fmt(q.grand_total)} ₺</td>
                  <td className="px-4 py-2"><div className="flex flex-col gap-0.5 items-start"><Badge s={q.status} /><ApprovalBadge quote={q} />{q.project_number && <div className="font-mono text-[10px] text-indigo-700">{q.project_number}</div>}{q.invoice_number && <div className="font-mono text-[10px] text-emerald-700">{q.invoice_number}</div>}</div></td>
                  <td className="px-4 py-2"><div className="flex justify-end gap-1 flex-wrap">
                    <button onClick={() => openPrintQuote(q)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg" title="Yazdır" data-testid={`print-quote-${q.quote_number}`}><Printer className="w-4 h-4" /></button>
                    <button onClick={() => openEditQuote(q)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg" title="Düzenle" data-testid={`edit-quote-${q.quote_number}`}><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => openApproval(q)} className={`px-2 py-1 rounded-lg font-semibold ${q.approval?.status === "accepted" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-900 text-white"}`} data-testid={`approval-quote-${q.quote_number}`}>{q.approval ? "Onay Durumu" : "Onaya Gönder"}</button>
                    <button onClick={() => setPlanQuote(q)} className={`px-2 py-1 border rounded-lg font-semibold ${q.payment_plan ? "border-violet-300 text-violet-700 bg-violet-50" : "text-slate-600"}`} data-testid={`plan-quote-${q.quote_number}`}>{q.payment_plan ? `${q.payment_plan.rows.length} Taksit` : "Ödeme Planı"}</button>
                    {q.status === "draft" && <button onClick={() => setStatus("quotes", q.id, "sent")} className="px-2 py-1 border rounded-lg font-semibold" data-testid={`send-quote-${q.quote_number}`}>Gönderildi</button>}
                    {!q.project_id && <button onClick={() => advanceFromQuote(q.id)} className="flex items-center gap-1 px-2 py-1 bg-slate-900 text-white rounded-lg font-semibold" data-testid={`quote-to-project-${q.quote_number}`}><Briefcase className="w-3 h-3" /> Projeye Çevir</button>}
                    {!q.invoice_id && <button onClick={() => act(() => axios.post(`${API_URL}/quotes/${q.id}/convert-to-invoice`, {}), "Fatura oluşturuldu.")} className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded-lg font-semibold" data-testid={`convert-quote-${q.quote_number}`}><FileText className="w-3 h-3" /> Faturaya Çevir</button>}
                    {!q.invoice_id && <button onClick={() => setStatus("quotes", q.id, "rejected")} className="px-2 py-1 border rounded-lg text-rose-600" data-testid={`reject-quote-${q.quote_number}`}>Red</button>}
                    <button onClick={() => del("quotes", q.id)} className="p-1.5 text-slate-300 hover:text-rose-600" data-testid={`delete-quote-${q.quote_number}`}><Trash2 className="w-4 h-4" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody></table></div>
        </>
      )}

      {!listLoading && tab === "projects" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.length === 0 && <div className="col-span-full text-center text-xs text-slate-400 py-8 bg-white border border-dashed rounded-2xl">Henüz proje yok.</div>}
          {projects.map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs" data-testid={`project-card-${p.project_number}`}>
              <div className="flex justify-between items-start"><div><div className="font-mono text-[10px] text-slate-400">{p.project_number}{p.quote_number ? ` · ${p.quote_number}` : ""}</div><div className="font-bold text-slate-900 text-sm">{p.name}</div><div className="text-slate-500">{p.contact_name || "—"} {p.address && `• ${p.address}`}</div></div><Badge s={p.status} map={projectStatusMap} /></div>
              <div className="grid grid-cols-2 gap-1 text-[10px]" data-testid={`project-stats-${p.project_number}`}>
                <div className="bg-slate-50 rounded-lg p-1.5"><div className="text-slate-400">Bütçe</div><b>{fmt(p.budget)} ₺</b></div>
                <div className="bg-slate-50 rounded-lg p-1.5"><div className="text-slate-400">Teklif</div><b>{p.quote_count || 0} • {fmt(p.quoted_total)} ₺</b></div>
                <div className="bg-slate-50 rounded-lg p-1.5"><div className="text-slate-400">Faturalanan</div><b className="text-emerald-700">{fmt(p.invoiced_total)} ₺</b></div>
                <div className="bg-slate-50 rounded-lg p-1.5" data-testid={`project-expense-total-${p.project_number}`}>
                  <div className="text-slate-400">Masraf</div>
                  <b className={(p.expense_total || 0) > 0 ? "text-rose-700" : ""}>{fmt(p.expense_total)} ₺</b>
                  {(p.purchase_invoice_total || 0) > 0 ? (
                    <div className="text-[9px] text-slate-400 font-semibold mt-0.5">Harcanan {fmt(p.cost_total)} ₺</div>
                  ) : null}
                </div>
              </div>
              {p.description && <p className="text-slate-600">{p.description}</p>}
              <ImageStrip entity="project" doc={p} onUpdated={load} />
              <div className="flex items-center gap-1.5 flex-wrap"><TrackingBadge project={p} /></div>
              {(() => {
                const tasks = p.tasks || [];
                const assigned = tasks.filter((t) => t.assignee_name || t.assignee_id);
                const done = tasks.filter((t) => t.done || t.status === "done" || t.status === "completed").length;
                if (!tasks.length) return null;
                return (
                  <div className="flex flex-wrap gap-1.5 text-[10px]" data-testid={`project-summary-${p.project_number}`}>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-semibold border border-indigo-100">
                      <Users className="w-3 h-3" /> {done}/{tasks.length} görev{assigned.length ? ` · ${assigned.length} atanmış` : ""}
                    </span>
                  </div>
                );
              })()}
              <div className="grid grid-cols-2 gap-1.5" data-testid={`project-quick-actions-${p.project_number}`}>
                <button type="button" onClick={() => setExpenseProject(p)} className="flex items-center justify-center gap-1.5 px-2.5 py-2 border border-rose-200 text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-xl font-bold" data-testid={`project-expense-${p.project_number}`} title="Bu projeye masraf ekle">
                  <Receipt className="w-3.5 h-3.5" /> Masraf Ekle
                </button>
                <button type="button" onClick={() => setTeamProject(p)} className="flex items-center justify-center gap-1.5 px-2.5 py-2 border border-indigo-200 text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-xl font-bold" data-testid={`project-team-${p.project_number}`} title="Personel ata ve görev dağıt">
                  <Users className="w-3.5 h-3.5" /> Personel / Görev
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t">
                <select value={p.status} onChange={(e) => setStatus("projects", p.id, e.target.value)} className="bg-slate-50 border rounded-lg p-1.5 text-[11px] min-w-0 flex-1 sm:flex-none" data-testid={`project-status-${p.project_number}`}>
                  {!projectStages.some((s) => s.key === p.status) && p.status ? <option value={p.status}>{STATUS[p.status]?.[0] || p.status}</option> : null}
                  {projectStages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <button onClick={() => openTracking(p)} className="flex items-center gap-1 px-2.5 py-1.5 border border-emerald-200 text-emerald-700 bg-emerald-50 rounded-lg font-semibold" data-testid={`project-track-${p.project_number}`} title="Müşteriye durum takip linki gönder"><Link2 className="w-3.5 h-3.5" /> Takip Linki</button>
                {p.status !== finalStage ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`${p.name || p.project_number} projesi tamamlandı olarak işaretlensin mi?`)) return;
                      setStatus("projects", p.id, finalStage);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold"
                    data-testid={`project-complete-${p.project_number}`}
                    title="Projeyi tamamlandı yap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Projeyi Tamamla
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg font-semibold" data-testid={`project-completed-${p.project_number}`}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> {projectStatusMap[finalStage]?.[0] || "Proje Tamamlandı"}
                  </span>
                )}
                <button onClick={() => del("projects", p.id)} className="p-1.5 text-slate-300 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!listLoading && tab === "surveys" && (
        <>
          {visibleSurveys.length === 0 && <div className="text-center text-xs text-slate-400 py-8 bg-white border border-dashed rounded-2xl">{onlyPending && surveys.length ? "Planlanan keşif yok — filtreyi kapatarak tümünü görebilirsiniz." : "Henüz keşif yok."}</div>}
          <div className="md:hidden space-y-3">
            {visibleSurveys.map((s) => (
              <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2 text-xs" data-testid={`survey-row-${s.survey_number}`}>
                <div className="flex justify-between gap-2 items-start">
                  <div className="min-w-0"><div className="font-mono font-bold">{s.survey_number}</div><div className="text-slate-500">{s.survey_date}{s.assigned_to ? ` • ${s.assigned_to}` : ""}</div><div className="font-semibold mt-0.5">{s.contact_name || "—"}</div><div className="text-slate-500 truncate">{s.address}{s.location_url && <> · <a href={s.location_url} target="_blank" rel="noreferrer" className="text-rose-600 font-semibold">Konum</a></>}</div></div>
                  <Badge s={s.status} />
                </div>
                {(s.measurements || []).length > 0 && <div className="text-slate-600 bg-slate-50 rounded-lg p-2">{(s.measurements || []).map((m, i) => <div key={i}>{m.name}: {m.quantity} {m.unit}</div>)}</div>}
                <ImageStrip entity="survey" doc={s} onUpdated={load} />
                <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                  {s.status === "planned" && <button onClick={() => setStatus("surveys", s.id, "done")} className="px-2.5 py-1.5 border rounded-lg font-semibold" data-testid={`survey-done-${s.survey_number}`}>Yapıldı</button>}
                  {!s.quote_id && <button onClick={() => advanceFromSurvey(s.id)} className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid={`survey-to-quote-${s.survey_number}`}>Teklife Çevir <ArrowRight className="w-3 h-3" /></button>}
                  <button onClick={() => del("surveys", s.id)} className="p-2 text-slate-300 hover:text-rose-600 ml-auto"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-x-auto"><table className="min-w-[720px] w-full text-left text-xs">
            <thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold"><tr><th className="px-4 py-2">Keşif</th><th className="px-4 py-2">Cari / Adres</th><th className="px-4 py-2">Ölçüler</th><th className="px-4 py-2">Görseller</th><th className="px-4 py-2">Durum</th><th className="px-4 py-2"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleSurveys.map((s) => (
                <tr key={s.id} data-testid={`survey-row-desk-${s.survey_number}`}>
                  <td className="px-4 py-2"><div className="font-mono font-bold">{s.survey_number}</div><div className="text-slate-500">{s.survey_date} {s.assigned_to && `• ${s.assigned_to}`}</div></td>
                  <td className="px-4 py-2"><div className="font-semibold">{s.contact_name || "—"}</div><div className="text-slate-500">{s.address} {s.location_url && <a href={s.location_url} target="_blank" rel="noreferrer" className="text-rose-600 font-semibold">• Konum</a>}</div>{s.notes && <div className="text-slate-400 italic">{s.notes}</div>}</td>
                  <td className="px-4 py-2 text-slate-600">{(s.measurements || []).map((m, i) => <div key={i}>{m.name}: {m.quantity} {m.unit}</div>)}</td>
                  <td className="px-4 py-2"><ImageStrip entity="survey" doc={s} onUpdated={load} /></td>
                  <td className="px-4 py-2"><Badge s={s.status} /></td>
                  <td className="px-4 py-2"><div className="flex justify-end gap-1 flex-wrap">
                    {s.status === "planned" && <button onClick={() => setStatus("surveys", s.id, "done")} className="px-2 py-1 border rounded-lg font-semibold" data-testid={`survey-done-${s.survey_number}`}>Yapıldı</button>}
                    {!s.quote_id && <button onClick={() => advanceFromSurvey(s.id)} className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded-lg font-semibold" data-testid={`survey-to-quote-${s.survey_number}`}>Teklife Çevir <ArrowRight className="w-3 h-3" /></button>}
                    <button onClick={() => del("surveys", s.id)} className="p-1.5 text-slate-300 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                  </div></td>
                </tr>
              ))}
            </tbody></table></div>
        </>
      )}

      {form && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form onSubmit={save} className={`bg-white rounded-t-2xl sm:rounded-2xl w-full p-4 sm:p-6 space-y-3 text-xs shadow-2xl max-h-[92vh] overflow-y-auto ${form.kind === "project" ? "max-w-2xl" : "max-w-6xl"}`} data-testid={`${form.kind}-form`}>
            <div className="flex justify-between border-b pb-2"><h3 className="text-sm font-bold">{form.kind === "quote" ? (form.id ? "Teklifi Düzenle" : "Yeni Teklif") : form.kind === "project" ? "Yeni Proje" : "Yeni Keşif"}</h3><button type="button" onClick={() => setForm(null)} className="text-slate-400"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div><label className="block font-semibold mb-1 flex justify-between">Cari <button type="button" onClick={() => setNewContact({ name: "", tax: "", phone: "", email: "", address: "" })} className="text-emerald-700 font-semibold hover:underline" data-testid="pf-new-contact-btn">+ Yeni cari aç</button></label><SearchSelect value={form.contact_id} options={contacts} placeholder="Cari ara..." getLabel={(c) => c.name} getSub={(c) => c.phone || c.email || ""} onChange={setContact} testId="pf-contact" /></div>
              {form.kind === "quote" && <div><label className="block font-semibold mb-1">Başlık</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="Fiyat Teklifi" data-testid="pf-title" /></div>}
              {form.kind === "project" && <div><label className="block font-semibold mb-1">Proje Adı</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required data-testid="pf-name" /></div>}
              {form.kind === "survey" && <div><label className="block font-semibold mb-1">Keşif Tarihi</label><input type="date" value={form.survey_date} onChange={(e) => setForm({ ...form, survey_date: e.target.value })} className={inputCls} /></div>}
            </div>
            {newContact && (
              <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-3 space-y-2" data-testid="pf-new-contact-form">
                <div className="font-bold text-emerald-800">Yeni Cari</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} placeholder="Ünvan / Ad Soyad *" className={`${inputCls} col-span-2`} data-testid="pf-nc-name" />
                  <input value={newContact.tax} onChange={(e) => setNewContact({ ...newContact, tax: e.target.value })} placeholder="VKN / TCKN" className={inputCls} data-testid="pf-nc-tax" />
                  <input value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} placeholder="Telefon" className={inputCls} data-testid="pf-nc-phone" />
                  <input value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} placeholder="E-posta" className={inputCls} />
                  <input value={newContact.address} onChange={(e) => setNewContact({ ...newContact, address: e.target.value })} placeholder="Adres" className={inputCls} />
                </div>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setNewContact(null)} className="px-3 py-1.5 border rounded-lg bg-white">İptal</button><button type="button" onClick={createContact} disabled={!newContact.name.trim()} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="pf-nc-save">Cariyi Kaydet & Seç</button></div>
              </div>
            )}
            {form.kind === "quote" && <div className="grid grid-cols-2 gap-2"><div><label className="block font-semibold mb-1">Geçerlilik</label><input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} className={inputCls} /></div></div>}
            {form.kind === "project" && <div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><div><label className="block font-semibold mb-1">Bütçe (₺)</label><input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className={inputCls} data-testid="pf-budget" /></div><div><label className="block font-semibold mb-1">Başlangıç</label><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={inputCls} /></div><div><label className="block font-semibold mb-1">Bitiş</label><input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={inputCls} /></div></div>}
            {form.kind !== "quote" && <div className="space-y-1.5">
              <label className="block font-semibold mb-1">Adres / Saha</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} data-testid="pf-address" />
              <div className="flex gap-1.5">
                <div className="relative flex-1 min-w-0"><MapPin className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-rose-500" /><input value={form.location_url || ""} onChange={(e) => setForm({ ...form, location_url: e.target.value, ...parseLoc(e.target.value) })} placeholder="Harita / konum linki" className={`${inputCls} pl-8`} data-testid="pf-location-url" /></div>
                <button type="button" onClick={useMyLocation} className="flex items-center gap-1 px-2.5 sm:px-3 border rounded-lg font-semibold hover:bg-slate-50 shrink-0" data-testid="pf-use-my-location"><LocateFixed className="w-3.5 h-3.5" /> <span className="hidden xs:inline sm:inline">Konumum</span></button>
              </div>
              {form.latitude && <div className="text-[10px] text-emerald-700 font-mono">Konum: {form.latitude}, {form.longitude} <a href={form.location_url} target="_blank" rel="noreferrer" className="underline">haritada aç</a></div>}
            </div>}
            {form.kind !== "project" && (
              <div className="space-y-2">
                <label className="block font-semibold">{form.kind === "quote" ? "Kalemler" : "Ölçüler / Kalemler (isteğe bağlı fiyat)"}</label>
                <DocumentLineEditor
                  items={items}
                  onChange={setItems}
                  products={products}
                  kind="quote"
                  allowService
                  invoiceType="sales"
                  testIdPrefix="q-item"
                  defaultVat={20}
                />
                <LineTotalsFooter
                  subtotal={lineTotals.subtotal}
                  vat={lineTotals.vat}
                  lineDiscount={lineTotals.lineDiscount}
                  grandTotal={lineTotals.grandTotal}
                />
              </div>
            )}
            <div><label className="block font-semibold mb-1">Notlar</label><textarea value={form.notes || form.description || ""} onChange={(e) => setForm({ ...form, notes: e.target.value, description: e.target.value })} rows={2} className={inputCls} /></div>
            <div className="flex justify-end gap-2 pt-2 border-t"><button type="button" onClick={() => setForm(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="pf-save-btn">Kaydet</button></div>
          </form>
        </div>
      )}
      {approvalQuote && <QuoteSendApprovalModal quote={approvalQuote} contact={contacts.find((c) => c.id === approvalQuote.contact_id)} onClose={() => setApprovalQuote(null)} onSent={load} />}
      {trackingProject && <ProjectTrackingModal project={trackingProject} contact={contacts.find((c) => c.id === trackingProject.contact_id)} onClose={() => setTrackingProject(null)} onSent={load} />}
      {expenseProject && <ProjectExpenseModal project={expenseProject} companyId={companyId} onClose={() => setExpenseProject(null)} onSaved={load} />}
      {teamProject && <ProjectTeamTasksModal project={teamProject} companyId={companyId} onClose={() => setTeamProject(null)} onSaved={load} />}
      {planQuote && <InstallmentPlanModal doc={planQuote} kind="quote" companyId={companyId} onClose={() => setPlanQuote(null)} onChanged={load} />}
      {printDoc && <PrintDocument docType={printDoc.type} doc={printDoc.doc} company={activeCompany} onClose={() => setPrintDoc(null)} onEditTemplate={() => setEditTpl(true)} />}
      {editTpl && <PrintTemplateEditor companyId={companyId} docType="quote" onClose={() => setEditTpl(false)} />}
    </div>
  );
}
