import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, ChevronRight, ImagePlus, Loader2, X } from "lucide-react";
import { API_URL, useAuth } from "../../context/AuthContext";
import { useHelp } from "../../context/HelpContext";
import { ONBOARDING_STEPS, firstRemainingIndex, invoiceLineTotals, progressLabel } from "../../help/onboarding";

const inputCls = "w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400/40";

export function OnboardingWizard() {
  const { user, activeCompany, reloadSession } = useAuth();
  const { onboarding, showWizard, patchOnboarding, loadOnboarding, closeWizard, companyId } = useHelp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [company, setCompany] = useState({ name: "", tax_number: "", tax_office: "", address: "", city: "", phone: "", email: "" });
  const [einvoice, setEinvoice] = useState(null);
  const [eiForm, setEiForm] = useState({ username: "", password: "", corporate_code: "", alias: "", company_tax_id: "", mode: "test" });
  const [contact, setContact] = useState({ name: "", tax_number_or_id: "", type: "customer", phone: "" });
  const [product, setProduct] = useState({ name: "", sku: "", sale_price: "100", vat_rate: "20" });
  const [invoice, setInvoice] = useState({ contact_id: "", product_id: "", quantity: "1", unit_price: "100", vat_rate: "20" });
  const [lists, setLists] = useState({ contacts: [], products: [] });

  const cid = companyId || activeCompany?.id || activeCompany?._id;

  useEffect(() => {
    if (!showWizard || !onboarding) return;
    setStep(firstRemainingIndex(onboarding));
  }, [showWizard, onboarding]);

  useEffect(() => {
    if (!showWizard || !cid) return;
    axios.get(`${API_URL}/companies/${cid}`).then((r) => {
      const c = r.data || {};
      setCompany({
        name: c.name || "",
        tax_number: c.tax_number || "",
        tax_office: c.tax_office || "",
        address: c.address || "",
        city: c.city || "",
        phone: c.phone || "",
        email: c.email || user?.email || "",
      });
    }).catch(() => {});
    axios.get(`${API_URL}/einvoice/settings`, { params: { company_id: cid } }).then((r) => {
      setEinvoice(r.data);
      setEiForm((f) => ({
        ...f,
        username: r.data.username || "",
        corporate_code: r.data.corporate_code || "",
        alias: r.data.alias || "",
        company_tax_id: r.data.company_tax_id || "",
        mode: r.data.mode || "test",
      }));
    }).catch(() => setEinvoice(null));
    Promise.all([
      axios.get(`${API_URL}/contacts`, { params: { company_id: cid } }),
      axios.get(`${API_URL}/products`, { params: { company_id: cid } }),
    ]).then(([cr, pr]) => {
      const contacts = cr.data?.contacts || cr.data || [];
      const products = pr.data?.products || pr.data || [];
      setLists({ contacts: Array.isArray(contacts) ? contacts : [], products: Array.isArray(products) ? products : [] });
      setInvoice((inv) => ({
        ...inv,
        contact_id: inv.contact_id || (contacts[0]?.id || contacts[0]?._id || ""),
        product_id: inv.product_id || (products[0]?.id || products[0]?._id || ""),
        unit_price: products[0]?.sale_price != null ? String(products[0].sale_price) : inv.unit_price,
      }));
    }).catch(() => {});
  }, [showWizard, cid, user?.email]);

  const current = ONBOARDING_STEPS[step] || ONBOARDING_STEPS[0];
  const percent = onboarding?.progress_percent || 0;
  const stepMeta = useMemo(() => {
    const map = {};
    (onboarding?.steps || []).forEach((s) => { map[s.key] = s; });
    return map;
  }, [onboarding]);

  if (!showWizard) return null;

  const goNext = () => setStep((s) => Math.min(ONBOARDING_STEPS.length - 1, s + 1));

  const skip = async () => {
    setBusy(true);
    try {
      await patchOnboarding({ action: "skip", step: current.key });
      if (step >= ONBOARDING_STEPS.length - 1) closeWizard();
      else goNext();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Atlanamadı.");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await patchOnboarding({ action: "dismiss" });
      closeWizard();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kapatılamadı.");
      closeWizard();
    } finally {
      setBusy(false);
    }
  };

  const markDone = async () => {
    await patchOnboarding({ action: "complete", step: current.key });
    await loadOnboarding();
    if (step >= ONBOARDING_STEPS.length - 1) {
      toast.success("Kurulum tamamlandı.");
      closeWizard();
    } else goNext();
  };

  const saveCompany = async (e) => {
    e.preventDefault();
    if (!company.name.trim()) { toast.error("Firma unvanı girin."); return; }
    setBusy(true);
    try {
      await axios.put(`${API_URL}/companies/${cid}`, company);
      if (reloadSession) await reloadSession();
      await markDone();
      toast.success("Firma bilgileri kaydedildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi.");
    } finally { setBusy(false); }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await axios.post(`${API_URL}/files/upload?entity=company&entity_id=${cid}&company_id=${cid}`, fd);
      if (reloadSession) await reloadSession();
      await markDone();
      toast.success("Logo yüklendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Logo yüklenemedi.");
    } finally { setBusy(false); }
  };

  const saveEinvoice = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.put(`${API_URL}/einvoice/settings`, { company_id: cid, ...eiForm });
      await markDone();
      toast.success("e-Fatura bağlantısı kaydedildi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Kaydedilemedi. Entegratör atanmadıysa bu adımı atlayın.");
    } finally { setBusy(false); }
  };

  const saveContact = async (e) => {
    e.preventDefault();
    if (!contact.name.trim()) { toast.error("Cari unvanı girin."); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/contacts`, {
        company_id: cid,
        type: contact.type,
        name: contact.name,
        tax_number_or_id: contact.tax_number_or_id || "11111111111",
        phone: contact.phone || "",
      });
      setLists((l) => ({ ...l, contacts: [r.data, ...l.contacts] }));
      setInvoice((inv) => ({ ...inv, contact_id: r.data.id || r.data._id || inv.contact_id }));
      await markDone();
      toast.success("Cari oluşturuldu.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Cari eklenemedi.");
    } finally { setBusy(false); }
  };

  const saveProduct = async (e) => {
    e.preventDefault();
    if (!product.name.trim()) { toast.error("Ürün adı girin."); return; }
    setBusy(true);
    try {
      const sku = product.sku.trim() || `SKU-${Date.now().toString().slice(-6)}`;
      const r = await axios.post(`${API_URL}/products`, {
        company_id: cid,
        name: product.name,
        sku,
        sale_price: Number(product.sale_price) || 0,
        vat_rate: Number(product.vat_rate) || 20,
        unit: "Adet",
        type: "product",
      });
      setLists((l) => ({ ...l, products: [r.data, ...l.products] }));
      setInvoice((inv) => ({
        ...inv,
        product_id: r.data.id || r.data._id || inv.product_id,
        unit_price: String(r.data.sale_price ?? inv.unit_price),
      }));
      await markDone();
      toast.success("Ürün oluşturuldu.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Ürün eklenemedi.");
    } finally { setBusy(false); }
  };

  const saveInvoice = async (e) => {
    e.preventDefault();
    const cRow = lists.contacts.find((x) => (x.id || x._id) === invoice.contact_id) || lists.contacts[0];
    const pRow = lists.products.find((x) => (x.id || x._id) === invoice.product_id) || lists.products[0];
    if (!cRow) { toast.error("Önce bir cari ekleyin veya cari adımını atlamayın."); return; }
    if (!pRow) { toast.error("Önce bir ürün ekleyin veya ürün adımını atlamayın."); return; }
    const qty = Number(invoice.quantity) || 1;
    const price = Number(invoice.unit_price) || Number(pRow.sale_price) || 0;
    const vat = Number(invoice.vat_rate) || Number(pRow.vat_rate) || 20;
    const t = invoiceLineTotals({ quantity: qty, unit_price: price, vat_rate: vat });
    setBusy(true);
    try {
      await axios.post(`${API_URL}/invoices`, {
        company_id: cid,
        invoice_type: "sales",
        e_type: "e_archive",
        contact_id: cRow.id || cRow._id,
        contact_name: cRow.name,
        contact_tax_id: cRow.tax_number_or_id,
        status: "draft",
        items: [{
          product_id: pRow.id || pRow._id,
          name: pRow.name,
          quantity: qty,
          unit: pRow.unit || "Adet",
          unit_price: price,
          vat_rate: vat,
          total: t.total,
          vat_amount: t.vat_amount,
          total_incl: t.total_incl,
        }],
        subtotal: t.total,
        vat_total: t.vat_amount,
        grand_total: t.total_incl,
      });
      await markDone();
      toast.success("İlk fatura taslak olarak kaydedildi.");
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Fatura kaydedilemedi.");
    } finally { setBusy(false); }
  };

  const body = (() => {
    if (current.key === "company") {
      return (
        <form onSubmit={saveCompany} className="space-y-3" data-testid="onboarding-step-company">
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-xs font-semibold">Unvan<input required className={inputCls} value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} data-testid="onb-company-name" /></label>
            <label className="text-xs font-semibold">VKN / TCKN<input className={inputCls} value={company.tax_number} onChange={(e) => setCompany({ ...company, tax_number: e.target.value })} data-testid="onb-company-tax" /></label>
            <label className="text-xs font-semibold">Vergi dairesi<input className={inputCls} value={company.tax_office} onChange={(e) => setCompany({ ...company, tax_office: e.target.value })} /></label>
            <label className="col-span-2 text-xs font-semibold">Adres<input className={inputCls} value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} /></label>
            <label className="text-xs font-semibold">İl<input className={inputCls} value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} /></label>
            <label className="text-xs font-semibold">Telefon<input className={inputCls} value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></label>
          </div>
          <button type="submit" disabled={busy} className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold disabled:opacity-60" data-testid="onb-company-save">{busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Kaydet ve devam"}</button>
        </form>
      );
    }
    if (current.key === "logo") {
      return (
        <div className="space-y-3" data-testid="onboarding-step-logo">
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-2xl p-6 cursor-pointer hover:bg-slate-50">
            <ImagePlus className="w-8 h-8 text-slate-400" />
            <span className="text-xs text-slate-500">PNG veya JPG yükleyin</span>
            <input type="file" accept="image/*" className="hidden" data-testid="onb-logo-file" onChange={(e) => uploadLogo(e.target.files?.[0])} />
          </label>
        </div>
      );
    }
    if (current.key === "einvoice") {
      const assigned = Boolean(einvoice?.assigned || einvoice?.provider);
      return (
        <form onSubmit={saveEinvoice} className="space-y-3" data-testid="onboarding-step-einvoice">
          {!assigned && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3">
              Entegratör henüz atanmadı. Platform Yönetimi atadıktan sonra bağlayabilirsiniz; şimdilik atlayabilirsiniz.
            </div>
          )}
          {assigned && (
            <>
              <div className="text-xs text-slate-500">Entegratör: <b className="text-slate-800">{einvoice.provider_name || einvoice.provider}</b></div>
              {(einvoice.fields || ["username", "password"]).includes("username") && (
                <label className="text-xs font-semibold block">Kullanıcı adı<input className={inputCls} value={eiForm.username} onChange={(e) => setEiForm({ ...eiForm, username: e.target.value })} /></label>
              )}
              {(einvoice.fields || []).includes("password") || !(einvoice.fields || []).length ? (
                <label className="text-xs font-semibold block">Şifre<input type="password" className={inputCls} value={eiForm.password} onChange={(e) => setEiForm({ ...eiForm, password: e.target.value })} /></label>
              ) : null}
              {(einvoice.fields || []).includes("corporate_code") && (
                <label className="text-xs font-semibold block">Kurum kodu<input className={inputCls} value={eiForm.corporate_code} onChange={(e) => setEiForm({ ...eiForm, corporate_code: e.target.value })} /></label>
              )}
              {(einvoice.fields || []).includes("alias") && (
                <label className="text-xs font-semibold block">GİB alias<input className={inputCls} value={eiForm.alias} onChange={(e) => setEiForm({ ...eiForm, alias: e.target.value })} /></label>
              )}
              {(einvoice.fields || []).includes("company_tax_id") && (
                <label className="text-xs font-semibold block">VKN<input className={inputCls} value={eiForm.company_tax_id} onChange={(e) => setEiForm({ ...eiForm, company_tax_id: e.target.value })} /></label>
              )}
              <button type="submit" disabled={busy} className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold disabled:opacity-60" data-testid="onb-einvoice-save">Kaydet ve devam</button>
            </>
          )}
        </form>
      );
    }
    if (current.key === "contact") {
      return (
        <form onSubmit={saveContact} className="space-y-3" data-testid="onboarding-step-contact">
          <label className="text-xs font-semibold block">Unvan<input required className={inputCls} value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} data-testid="onb-contact-name" /></label>
          <label className="text-xs font-semibold block">VKN / TCKN<input className={inputCls} value={contact.tax_number_or_id} onChange={(e) => setContact({ ...contact, tax_number_or_id: e.target.value })} /></label>
          <label className="text-xs font-semibold block">Tür
            <select className={inputCls} value={contact.type} onChange={(e) => setContact({ ...contact, type: e.target.value })}>
              <option value="customer">Müşteri</option>
              <option value="supplier">Tedarikçi</option>
              <option value="both">Her ikisi</option>
            </select>
          </label>
          <button type="submit" disabled={busy} className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold disabled:opacity-60" data-testid="onb-contact-save">Cariyi oluştur</button>
        </form>
      );
    }
    if (current.key === "product") {
      return (
        <form onSubmit={saveProduct} className="space-y-3" data-testid="onboarding-step-product">
          <label className="text-xs font-semibold block">Ürün adı<input required className={inputCls} value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} data-testid="onb-product-name" /></label>
          <label className="text-xs font-semibold block">SKU (boşsa üretilir)<input className={inputCls} value={product.sku} onChange={(e) => setProduct({ ...product, sku: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold">Satış fiyatı<input type="number" step="0.01" className={inputCls} value={product.sale_price} onChange={(e) => setProduct({ ...product, sale_price: e.target.value })} /></label>
            <label className="text-xs font-semibold">KDV %<input type="number" className={inputCls} value={product.vat_rate} onChange={(e) => setProduct({ ...product, vat_rate: e.target.value })} /></label>
          </div>
          <button type="submit" disabled={busy} className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold disabled:opacity-60" data-testid="onb-product-save">Ürünü oluştur</button>
        </form>
      );
    }
    return (
      <form onSubmit={saveInvoice} className="space-y-3" data-testid="onboarding-step-invoice">
        <label className="text-xs font-semibold block">Cari
          <select className={inputCls} value={invoice.contact_id} onChange={(e) => setInvoice({ ...invoice, contact_id: e.target.value })} data-testid="onb-invoice-contact">
            <option value="">Seçin…</option>
            {lists.contacts.map((c) => <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold block">Ürün
          <select className={inputCls} value={invoice.product_id} onChange={(e) => setInvoice({ ...invoice, product_id: e.target.value })}>
            <option value="">Seçin…</option>
            {lists.products.map((p) => <option key={p.id || p._id} value={p.id || p._id}>{p.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs font-semibold">Miktar<input type="number" className={inputCls} value={invoice.quantity} onChange={(e) => setInvoice({ ...invoice, quantity: e.target.value })} /></label>
          <label className="text-xs font-semibold">Birim fiyat<input type="number" step="0.01" className={inputCls} value={invoice.unit_price} onChange={(e) => setInvoice({ ...invoice, unit_price: e.target.value })} /></label>
          <label className="text-xs font-semibold">KDV %<input type="number" className={inputCls} value={invoice.vat_rate} onChange={(e) => setInvoice({ ...invoice, vat_rate: e.target.value })} /></label>
        </div>
        <button type="submit" disabled={busy} className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold disabled:opacity-60" data-testid="onb-invoice-save">Taslak fatura oluştur</button>
      </form>
    );
  })();

  return (
    <div className="fixed inset-0 z-[85] bg-slate-900/60 flex items-center justify-center p-4" data-testid="onboarding-wizard">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-indigo-500 font-bold">İlk kurulum</div>
              <h2 className="text-lg font-bold text-slate-900">TamKobi’yi kullanmaya başlayın</h2>
              <p className="text-xs text-slate-500 mt-0.5">{progressLabel(percent)} · İstediğiniz adımı atlayabilirsiniz.</p>
            </div>
            <button type="button" onClick={dismiss} className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Kapat" data-testid="onboarding-dismiss">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden" data-testid="onboarding-progress-bar">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {ONBOARDING_STEPS.map((s, i) => {
              const meta = stepMeta[s.key] || {};
              const active = i === step;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStep(i)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap ${active ? "bg-indigo-600 text-white" : meta.done ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-500"}`}
                  data-testid={`onboarding-step-tab-${s.key}`}
                >
                  {meta.done ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-1">{current.label}</h3>
          <p className="text-xs text-slate-500 mb-4">{current.hint}</p>
          {body}
          <div className="flex items-center justify-between mt-4">
            <button type="button" onClick={skip} disabled={busy} className="text-xs text-slate-500 hover:underline" data-testid="onboarding-skip-step">
              Bu adımı atla
            </button>
            <button type="button" onClick={dismiss} className="text-xs text-slate-400 hover:underline" data-testid="onboarding-skip-all">
              Tümünü atla
            </button>
            {step < ONBOARDING_STEPS.length - 1 && (
              <button type="button" onClick={goNext} className="ml-auto flex items-center gap-1 text-xs font-semibold text-indigo-700">
                Sonraki <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
