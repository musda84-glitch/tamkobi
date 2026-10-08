import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { toast } from "sonner";
import { X, Save, Loader2, User, Receipt, MapPin, Wallet, ShoppingCart, StickyNote, Upload, Image as ImageIcon, ShieldCheck, RefreshCw, FlaskConical, Trash2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";
import { compressImageFile } from "../utils/compressImage";
import { backdropDismissProps } from "../utils/modalBackdrop";
import { GibContactLookup } from "./GibContactLookup";
import { gibLookupToContactPatch, gibMukellefLabel, isCompleteTaxId, digitsTaxId } from "../utils/gibContactFill";

const inp = "w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/30";
const TABS = [["general", "Genel", User], ["tax", "Vergi & e-Fatura", Receipt], ["address", "Adres & Konum", MapPin], ["finance", "Finans & Vade", Wallet], ["b2b", "B2B Portal", ShoppingCart], ["notes", "Notlar & Etiket", StickyNote]];
const EMPTY = { type: "customer", name: "", company_title: "", contact_person: "", contact_person_phone: "", tax_number_or_id: "", tax_office: "", is_e_invoice_user: false, e_invoice_alias: "", email: "", phone: "", website: "", address: "", city: "İstanbul", district: "", location_url: "", credit_limit: 0, payment_term_days: 0, late_fee_rate: 0, default_discount: 0, currency: "TRY", payment_method: "", iban: "", bank_name: "", category: "Genel", sales_rep: "", risk_status: "normal", b2b_enabled: false, b2b_discount: 0, b2b_login_email: "", b2b_password: "", b2b_allow_orders: true, b2b_show_prices: true, b2b_show_stock: true, b2b_show_statement: true, b2b_show_installments: true, b2b_allow_ai_cart: true, b2b_min_order_amount: 0, b2b_welcome_note: "", sms_opt_in: true, email_opt_in: true, tags: [], notes: "", logo_url: "", is_active: true };

const b2bSettingsFromContact = (contact) => {
  const s = contact?.b2b_portal_settings || {};
  return {
    b2b_allow_orders: s.allow_orders !== false,
    b2b_show_prices: s.show_prices !== false,
    b2b_show_stock: s.show_stock !== false,
    b2b_show_statement: s.show_statement !== false,
    b2b_show_installments: s.show_installments !== false,
    b2b_allow_ai_cart: s.allow_ai_cart !== false,
    b2b_min_order_amount: Number(s.min_order_amount) || 0,
    b2b_welcome_note: s.welcome_note || "",
  };
};

export const ContactForm = ({ companyId, contact, onClose, onSaved }) => {
  const [tab, setTab] = useState("general");
  const [f, setF] = useState({ ...EMPTY, ...(contact || {}), ...b2bSettingsFromContact(contact), b2b_password: "", tags: contact?.tags || [], is_active: contact?.is_active !== false });
  const [busy, setBusy] = useState(false);
  const [gibBusy, setGibBusy] = useState(false);
  const [gibMeta, setGibMeta] = useState(null);
  const lastGibTax = useRef("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.type === "number" ? Number(e.target.value) : e.target.value });

  const applyGib = useCallback((res, { switchTab = true } = {}) => {
    if (!res) return;
    setF((prev) => ({ ...prev, ...gibLookupToContactPatch(res, prev) }));
    setGibMeta(res);
    lastGibTax.current = String(res.tax_id || "");
    if (switchTab) setTab((t) => (t === "general" ? "tax" : t));
  }, []);

  const fetchGibMukellef = useCallback(async (rawTax, { quiet = false, switchTab = false, force = false } = {}) => {
    const tid = digitsTaxId(rawTax);
    if (!isCompleteTaxId(tid)) return null;
    if (!force && tid === lastGibTax.current && gibMeta?.tax_id === tid) return gibMeta;
    setGibBusy(true);
    try {
      const r = await axios.get(`${API_URL}/gib/lookup`, { params: { tax_id: tid, company_id: companyId } });
      applyGib(r.data, { switchTab });
      if (!quiet) toast.success(r.data.message || "GİB mükellefiyeti güncellendi.");
      return r.data;
    } catch (err) {
      if (!quiet) toast.error(err.response?.data?.detail || "GİB sorgusu başarısız.");
      return null;
    } finally {
      setGibBusy(false);
    }
  }, [applyGib, companyId, gibMeta]);

  const onTaxIdChange = (e) => {
    const tid = digitsTaxId(e.target.value);
    setF((prev) => ({ ...prev, tax_number_or_id: tid }));
    if (tid !== lastGibTax.current) setGibMeta(null);
  };

  const onTaxIdBlur = () => {
    if (isCompleteTaxId(f.tax_number_or_id)) fetchGibMukellef(f.tax_number_or_id, { quiet: true });
  };

  useEffect(() => {
    const tid = digitsTaxId(f.tax_number_or_id);
    if (!isCompleteTaxId(tid) || tid === lastGibTax.current) return undefined;
    const t = setTimeout(() => fetchGibMukellef(tid, { quiet: true }), 450);
    return () => clearTimeout(t);
  }, [f.tax_number_or_id, fetchGibMukellef]);

  const F = (k, l, type = "text", extra = {}) => <div className={extra.span ? "sm:col-span-2" : ""}><label className="block font-semibold text-slate-700 mb-1">{l}</label><input type={type} value={f[k] ?? ""} onChange={set(k)} placeholder={extra.ph || ""} className={inp} data-testid={`cf-${k}`} /></div>;
  const S = (k, l, opts) => <div><label className="block font-semibold text-slate-700 mb-1">{l}</label><select value={f[k] ?? ""} onChange={set(k)} className={inp} data-testid={`cf-${k}`}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>;
  const C = (k, l) => <label className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 cursor-pointer"><input type="checkbox" checked={!!f[k]} onChange={set(k)} data-testid={`cf-${k}`} /><span className="font-semibold text-slate-700">{l}</span></label>;

  const mukellef = gibMukellefLabel(!!f.is_e_invoice_user);
  const mukellefTone = mukellef.tone === "emerald"
    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : "bg-blue-50 text-blue-800 border-blue-200";

  const gibBlock = (
    <div className="sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-1.5" data-testid="cf-gib-block">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold text-emerald-900">GİB’den cari çağır</p>
        <span className="text-[10px] text-emerald-700/80">VKN/TCKN → ünvan & e-Fatura / e-Arşiv</span>
      </div>
      <GibContactLookup companyId={companyId} onApply={(res) => applyGib(res, { switchTab: true })} />
    </div>
  );

  const mukellefBlock = (
    <div className={`sm:col-span-2 rounded-xl border px-3 py-2.5 space-y-1 ${mukellefTone}`} data-testid="cf-gib-mukellef">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="w-4 h-4 shrink-0" />
        <span className="font-bold text-xs" data-testid="cf-is_e_invoice_user">{mukellef.title}</span>
        {gibBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" data-testid="cf-gib-busy" />}
        {gibMeta?.source === "simulated" && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-md px-1.5 py-0.5">
            <FlaskConical className="w-3 h-3" /> SİMÜLE
          </span>
        )}
        {gibMeta?.source && gibMeta.source !== "simulated" && (
          <span className="text-[10px] font-semibold opacity-80">Kaynak: {gibMeta.source}</span>
        )}
        <button
          type="button"
          onClick={() => fetchGibMukellef(f.tax_number_or_id, { quiet: false, force: true })}
          disabled={gibBusy || !isCompleteTaxId(f.tax_number_or_id)}
          className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold underline disabled:opacity-40"
          data-testid="cf-gib-refresh"
        >
          <RefreshCw className={`w-3 h-3 ${gibBusy ? "animate-spin" : ""}`} /> GİB’den yenile
        </button>
      </div>
      <p className="text-[11px] opacity-90">{mukellef.hint} Mükellefiyet entegratör üzerinden GİB’den otomatik gelir; elle işaretlenmez.</p>
      <input type="checkbox" className="sr-only" checked={!!f.is_e_invoice_user} readOnly data-testid="cf-is_e_invoice_user-check" tabIndex={-1} aria-hidden />
    </div>
  );

  const uploadLogo = async (e) => {
    const raw = e.target.files?.[0];
    e.target.value = "";
    if (!raw) return;
    try {
      const file = await compressImageFile(raw);
      const fd = new FormData();
      fd.append("file", file);
      const cid = contact?.id || "";
      const r = await axios.post(`${API_URL}/files/upload?entity=contact&entity_id=${encodeURIComponent(cid)}&company_id=${encodeURIComponent(companyId || "")}`, fd);
      setF((prev) => ({ ...prev, logo_url: r.data.url }));
      toast.success(r.data?.saved_pct ? `Logo yüklendi (≈%${r.data.saved_pct} küçültüldü).` : "Logo yüklendi.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Logo yüklenemedi.");
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!f.name || !f.tax_number_or_id) { setTab("general"); return toast.error("Cari adı ve VKN/TCKN zorunludur."); }
    setBusy(true);
    try {
      let mukellefRes = gibMeta;
      if (isCompleteTaxId(f.tax_number_or_id)) {
        mukellefRes = await fetchGibMukellef(f.tax_number_or_id, { quiet: true, force: true }) || gibMeta;
      }
      const payload = { ...f, is_active: f.is_active !== false, tags: Array.isArray(f.tags) ? f.tags : String(f.tags).split(",").map((t) => t.trim()).filter(Boolean) };
      if (mukellefRes?.tax_id === digitsTaxId(payload.tax_number_or_id)) {
        payload.is_e_invoice_user = !!mukellefRes.is_e_invoice_user;
        if (mukellefRes.alias) payload.e_invoice_alias = mukellefRes.alias;
      }
      if (!payload.b2b_password) delete payload.b2b_password;
      const b2bSettings = {
        allow_orders: !!payload.b2b_allow_orders,
        show_prices: !!payload.b2b_show_prices,
        show_stock: !!payload.b2b_show_stock,
        show_statement: !!payload.b2b_show_statement,
        show_installments: !!payload.b2b_show_installments,
        allow_ai_cart: !!payload.b2b_allow_ai_cart,
        min_order_amount: Number(payload.b2b_min_order_amount) || 0,
        welcome_note: payload.b2b_welcome_note || "",
      };
      ["b2b_allow_orders", "b2b_show_prices", "b2b_show_stock", "b2b_show_statement", "b2b_show_installments", "b2b_allow_ai_cart", "b2b_min_order_amount", "b2b_welcome_note"].forEach((k) => delete payload[k]);
      const r = contact?.id ? await axios.put(`${API_URL}/contacts/${contact.id}`, payload) : await axios.post(`${API_URL}/contacts`, { company_id: companyId, ...payload });
      const id = r.data.id || r.data._id || contact?.id;
      if (id) {
        await axios.put(`${API_URL}/contacts/${id}/b2b-portal`, {
          enabled: !!payload.b2b_enabled,
          discount: payload.b2b_discount,
          password: payload.b2b_password || undefined,
          login_email: payload.b2b_login_email,
          settings: b2bSettings,
          base_url: window.location.origin,
        }).catch(() => {});
      }
      toast.success(contact?.id ? "Cari bilgileri güncellendi." : "Cari kartı oluşturuldu.");
      onSaved?.(r.data);
    } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(false); }
  };

  const remove = async () => {
    const id = contact?.id || contact?._id;
    if (!id) return;
    if (!window.confirm(`${f.name || "Bu cari"} silinsin mi? İşlemi olan cariler silinemez; pasife alabilirsiniz.`)) return;
    setBusy(true);
    try {
      const r = await axios.delete(`${API_URL}/contacts/${id}`);
      toast.success(r.data?.message || "Cari silindi.");
      onSaved?.({ ...contact, id, deleted: true });
    } catch (err) {
      toast.error(err.response?.data?.detail || "Cari silinemedi.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-sm overflow-y-auto overscroll-contain" {...backdropDismissProps(onClose)} data-testid="contact-form-overlay">
      <div className="min-h-full flex items-start justify-center p-4 sm:p-6">
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 max-h-[calc(100vh-2rem)] flex flex-col my-4 sm:my-6" data-testid="contact-form">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0"><div><h2 className="text-base font-bold text-slate-900">{contact?.id ? "Cari Bilgilerini Güncelle" : "Gelişmiş Cari Kartı Oluştur"}</h2><p className="text-[11px] text-slate-500">{contact?.name || "Cariye tanımlanabilen tüm özellikler tek ekranda"}</p></div><div className="flex items-center gap-2">{contact?.id ? <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${f.is_active !== false ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`} data-testid="cf-active-badge">{f.is_active !== false ? "Aktif" : "Pasif"}</span> : null}<button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="cf-close"><X className="w-5 h-5" /></button></div></div>
        <div className="flex gap-1 px-6 pt-3 overflow-x-auto shrink-0">{TABS.map(([k, l, Icon]) => <button type="button" key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid={`cf-tab-${k}`}><Icon className="w-3.5 h-3.5" />{l}</button>)}</div>
        <div className="p-6 overflow-y-auto text-xs space-y-3 flex-1 min-h-0">
          {tab === "general" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {gibBlock}
            <div className="sm:col-span-2 flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0" data-testid="cf-logo-preview">
                {f.logo_url ? <img src={resolveImageUrl(f.logo_url)} alt="cari logo" className="w-full h-full object-contain" /> : <ImageIcon className="w-8 h-8 text-slate-300" />}
              </div>
              <div className="space-y-1.5">
                <label className="inline-flex items-center gap-1.5 px-3 py-2 border rounded-lg cursor-pointer hover:bg-slate-50 font-semibold">
                  <Upload className="w-3.5 h-3.5" /> Logo Yükle
                  <input type="file" accept="image/*" className="hidden" onChange={uploadLogo} data-testid="cf-logo-input" />
                </label>
                {f.logo_url ? <button type="button" onClick={() => setF({ ...f, logo_url: "" })} className="block text-[11px] text-slate-500 hover:text-rose-600 font-semibold" data-testid="cf-logo-clear">Logoyu kaldır</button> : <p className="text-[11px] text-slate-500">PNG, JPG — cari kartında görünür.</p>}
              </div>
            </div>
            {S("type", "Cari Türü", [["customer", "Müşteri"], ["supplier", "Tedarikçi"], ["both", "Müşteri & Tedarikçi"]])}{F("category", "Kategori / Grup", "text", { ph: "Genel Bayi, Toptan, Perakende…" })}
            {F("name", "Cari Adı *", "text", { span: true })}{F("company_title", "Ticari Ünvan", "text", { span: true })}
            {F("contact_person", "Yetkili Kişi")}{F("contact_person_phone", "Yetkili Telefon")}{F("phone", "Telefon")}{F("email", "E-posta", "email")}{F("website", "Web Sitesi")}{F("sales_rep", "Satış Temsilcisi")}
            <div className="sm:col-span-2">
              <div className="text-[11px] font-semibold text-slate-700 mb-1">Cari durumu</div>
              <div className="flex rounded-xl border border-slate-200 overflow-hidden w-fit" data-testid="cf-active-toggle">
                <button type="button" onClick={() => setF({ ...f, is_active: true })} className={`px-3 py-1.5 text-xs font-bold ${f.is_active !== false ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`} data-testid="cf-active-on">Aktif</button>
                <button type="button" onClick={() => setF({ ...f, is_active: false })} className={`px-3 py-1.5 text-xs font-bold ${f.is_active === false ? "bg-slate-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`} data-testid="cf-active-off">Pasif</button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Pasif cari fatura, sipariş ve ekstre seçicilerinde görünmez; kart silinmez.</p>
            </div>
            <div className="sm:col-span-2 grid grid-cols-2 gap-2">{C("sms_opt_in", "SMS bildirimi alsın")}{C("email_opt_in", "E-posta bildirimi alsın")}</div>
          </div>}
          {tab === "tax" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {gibBlock}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">VKN / TCKN *</label>
              <input
                type="text"
                inputMode="numeric"
                value={f.tax_number_or_id ?? ""}
                onChange={onTaxIdChange}
                onBlur={onTaxIdBlur}
                placeholder="10 veya 11 hane — çıkınca GİB sorgulanır"
                className={inp}
                data-testid="cf-tax_number_or_id"
              />
            </div>
            {F("tax_office", "Vergi Dairesi")}
            {F("e_invoice_alias", "GİB PK Etiketi", "text", { span: true, ph: "urn:mail:…@…" })}
            {mukellefBlock}
            {S("currency", "Para Birimi", [["TRY", "₺ TRY"], ["USD", "$ USD"], ["EUR", "€ EUR"], ["GBP", "£ GBP"]])}{S("payment_method", "Varsayılan Ödeme Şekli", [["", "—"], ["cash", "Nakit"], ["transfer", "Havale/EFT"], ["card", "Kredi Kartı"], ["check", "Çek"], ["note", "Senet"], ["open_account", "Açık Hesap"]])}
          </div>}
          {tab === "address" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {F("address", "Adres", "text", { span: true })}{F("city", "İl")}{F("district", "İlçe")}{F("location_url", "Harita / Konum Linki", "text", { span: true, ph: "Google Maps linki" })}
          </div>}
          {tab === "finance" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {F("credit_limit", "Kredi / Risk Limiti (₺)", "number")}{F("payment_term_days", "Vade (gün)", "number")}{F("late_fee_rate", "Gecikme Faizi (% / ay)", "number")}{F("default_discount", "Varsayılan İskonto (%)", "number")}
            {S("risk_status", "Risk Durumu", [["normal", "Normal"], ["watch", "Takipte"], ["blocked", "Bloke (sipariş alınmaz)"]])}{F("bank_name", "Banka")}{F("iban", "IBAN", "text", { span: true, ph: "TR.." })}
          </div>}
          {tab === "b2b" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">{C("b2b_enabled", "B2B sipariş portalı erişimi açık")}</div>
            {F("b2b_discount", "B2B İskonto (%)", "number")}{F("b2b_login_email", "Portal Giriş E-postası", "email", { ph: "boş = cari e-postası / VKN" })}
            {F("b2b_password", contact?.b2b_password_hash || contact?.has_b2b_password ? "Portal Şifresi (değiştirmek için yazın)" : "Portal Şifresi (min 6)", "password", { span: true })}
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t">
              {C("b2b_allow_orders", "Sipariş alımı")}
              {C("b2b_show_prices", "Fiyatları göster")}
              {C("b2b_show_stock", "Stok durumunu göster")}
              {C("b2b_show_statement", "Hesap ekstresi sekmesi")}
              {C("b2b_show_installments", "Taksitler sekmesi")}
              {C("b2b_allow_ai_cart", "AI sepet (Excel/PDF)")}
            </div>
            {F("b2b_min_order_amount", "Minimum sipariş (₺)", "number")}
            {F("b2b_welcome_note", "Karşılama notu", "text", { span: true, ph: "Hoş geldiniz…" })}
            <p className="sm:col-span-2 text-[11px] text-slate-500">Bu özellikler yalnızca bu cariye uygulanır. Müşteri <b>{window.location.origin}/b2b/giris</b> adresinden e-posta/VKN + şifre ile girer. Detaylı yönetim cari kartı → B2B Portal sekmesinden de yapılır.</p>
          </div>}
          {tab === "notes" && <div className="space-y-3">
            <div><label className="block font-semibold text-slate-700 mb-1">Etiketler (virgülle)</label><input value={Array.isArray(f.tags) ? f.tags.join(", ") : f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="vip, ihracat, gecikmeli…" className={inp} data-testid="cf-tags" /></div>
            <div><label className="block font-semibold text-slate-700 mb-1">Notlar</label><textarea rows={5} value={f.notes || ""} onChange={set("notes")} className={inp} data-testid="cf-notes" /></div>
          </div>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t shrink-0 items-center">
          {contact?.id ? (
            <button type="button" onClick={remove} disabled={busy} className="mr-auto inline-flex items-center gap-1.5 px-3 py-2 border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-semibold disabled:opacity-60" data-testid="cf-delete">
              <Trash2 className="w-4 h-4" /> Cariyi sil
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-xl text-slate-600">İptal</button>
          <button type="submit" disabled={busy || gibBusy} className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-semibold flex items-center gap-1.5 disabled:opacity-60" data-testid="cf-save">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {contact?.id ? "Güncelle" : "Kaydet"}</button>
        </div>
      </form>
      </div>
    </div>,
    document.body
  );
};
