import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../api/client";
import { groupIdOf } from "../navGroups";
import { loadRadialSlots, normalizeRadialSlots, saveRadialSlotsLocal } from "../utils/radialQuickMenu";
import { personelMenuPathAllowed, selfPersonnelNavAllowed } from "../utils/selfPersonnelNav";
import { authPermPath, canAccessPath, isAddonEnabled, isFeatureEnabled, isModuleEnabled } from "../utils/authAccess";
import { setPriceDecimals } from "../utils/money";
import { getHostKind, hostUrl } from "../utils/hosts";
import { activeCompanyId } from "../utils/activeCompanyId";

const AuthContext = createContext(null);

export { API_URL, BACKEND_URL } from "../api/client";
axios.defaults.withCredentials = true;

const BASE_MENU = [
  { label: "Genel Bakış", path: "/panel" },
  { label: "Faturalar", path: "/invoices", badge: "GİB" },
  { label: "İthalat / İhracat", path: "/dis-ticaret", badge: "Gümrük" },
  { label: "Gelen e-Belgeler", path: "/edoc-inbox", badge: "Kutu" },
  { label: "İrsaliyeler", path: "/dispatches", badge: "e-İrsaliye" },
  { label: "Masraflar", path: "/expenses", badge: "Gider" },
  { label: "Krediler", path: "/loans", badge: "Banka" },
  { label: "Çek / Senet", path: "/cheques", badge: "Vade" },
  { label: "Cari Hesaplar", path: "/contacts" },
  { label: "Taksitler", path: "/installments", badge: "Vade" },
  { label: "Raporlar", path: "/reports", badge: "Excel" },
  { label: "Banka & Kasa & POS", path: "/banking" },
  { label: "Stoklar & Ürünler", path: "/stock", badge: "Barkod" },
  { label: "Verilen Siparişler", path: "/purchase-orders", badge: "Alış" },
  { label: "Hızlı Satış", path: "/hizli-satis", badge: "POS" },
  { label: "Stok Sayımı (Tablet)", path: "/sayim", badge: "Sayım" },
  { label: "Teklifler", path: "/quotes" },
  { label: "Projeler", path: "/projects" },
  { label: "Keşifler", path: "/surveys" },
  { label: "E-Ticaret Entegrasyon", path: "/ecommerce", badge: "Trendyol" },
  { label: "Kargo Entegrasyon", path: "/cargo", badge: "Yurtiçi" },
  { label: "Siparişler", path: "/orders", badge: "B2B" },
  { label: "Saha Sipariş", path: "/saha", badge: "Tablet" },
  { label: "Depo Sevkiyatı", path: "/sevk", badge: "Tablet" },
  { label: "Depo & Transfer", path: "/warehouses" },
  { label: "Araçlarım", path: "/vehicles", badge: "Filo" },
  { label: "Üretim & Reçete (BOM)", path: "/production" },
  { label: "Üretim Ekranı (Atölye)", path: "/atolye", badge: "Tablet" },
  { label: "Personel & Bordro", path: "/personnel" },
  { label: "Benim Sayfam", path: "/personelim", badge: "Self" },
  { label: "Mesaim", path: "/mesai", badge: "Puantaj" },
  { label: "İletişim: Mail & SMS", path: "/communication", badge: "SMS" },
  { label: "TamKobi AI Danışman", path: "/ai-advisor", aiBadge: true, isAi: true },
  { label: "Mali Müşavir Paneli", path: "/accountant", badge: "KDV" },
  { label: "Destek", path: "/support", badge: "Talep" },
  { label: "Çöp Kutusu", path: "/trash", badge: "30 gün" },
  { label: "İşlem Geçmişi", path: "/islem-gecmisi", badge: "1 yıl" },
];

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [license, setLicense] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [activeCompany, setActiveCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moduleOrder, setModuleOrder] = useState(() => { try { return JSON.parse(localStorage.getItem("module_order") || "[]"); } catch { return []; } });
  const [radialSlots, setRadialSlots] = useState(() => loadRadialSlots());

  const permPath = authPermPath;
  const can = useCallback((path, level = "view") => canAccessPath(user, path, level, permPath), [user]);
  const feature = useCallback((key) => isFeatureEnabled(user, key), [user]);
  const moduleOn = useCallback((path) => isModuleEnabled(user, license, path, permPath), [user, license]);
  const addonOn = useCallback((key) => isAddonEnabled(user, license, key), [user, license]);

  const menuItems = useMemo(() => {
    if (!user) return [];
    const roleCode = String(user?.role || "").trim().toLowerCase();
    const isCompanyAdmin = roleCode === "admin" || roleCode === "owner" || roleCode === "yönetici" || roleCode === "yonetici";
    const canSeeAudit = isCompanyAdmin || !!user?.is_super_admin || user?.features?.company_audit === true;
    const visible = (m) => {
      if (m.path === "/islem-gecmisi" && !canSeeAudit) return false;
      const personelOk = personelMenuPathAllowed(m.path, user) || (m.path === "/islem-gecmisi" && canSeeAudit);
      const allowed = m.path === "/islem-gecmisi" ? canSeeAudit : can(m.path);
      return m.isSystem ? !!user?.is_super_admin : allowed && moduleOn(m.path) && selfPersonnelNavAllowed(m.path, user) && personelOk && (m.path !== "/ai-advisor" || addonOn("ai.advisor")) && (m.path !== "/support" || addonOn("support.tickets"));
    };
    const rank = (path) => {
      const i = moduleOrder.indexOf(path);
      if (i !== -1 || moduleOrder.length === 0) return i === -1 ? BASE_MENU.findIndex((m) => m.path === path) : i;
      const bi = BASE_MENU.findIndex((m) => m.path === path);
      for (let k = bi - 1; k >= 0; k--) { const j = moduleOrder.indexOf(BASE_MENU[k].path); if (j !== -1) return j + 0.5 + bi / 1000; }
      return -0.5 + bi / 1000;
    };
    return BASE_MENU.filter(visible).sort((a, b) => rank(a.path) - rank(b.path));
  }, [user, moduleOrder, can, moduleOn, addonOn]);

  const persistOrder = useCallback(async (order) => {
    setModuleOrder(order);
    localStorage.setItem("module_order", JSON.stringify(order));
    try { await axios.put(`${API_URL}/auth/me/preferences`, { module_order: order }, { withCredentials: true }); } catch { /* offline */ }
  }, []);

  const moveModule = useCallback((from, to) => {
    if (to < 0 || to >= menuItems.length) return;
    const paths = menuItems.map((m) => m.path);
    const [moved] = paths.splice(from, 1);
    paths.splice(to, 0, moved);
    persistOrder(paths);
  }, [menuItems, persistOrder]);

  const moveModulePath = useCallback((fromPath, toPath) => {
    if (groupIdOf(fromPath) !== groupIdOf(toPath)) return;
    const paths = menuItems.map((m) => m.path);
    const from = paths.indexOf(fromPath);
    const to = paths.indexOf(toPath);
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = paths.splice(from, 1);
    paths.splice(to, 0, moved);
    persistOrder(paths);
  }, [menuItems, persistOrder]);

  const resetModuleOrder = useCallback(() => persistOrder([]), [persistOrder]);

  const persistRadialSlots = useCallback(async (slots) => {
    const normalized = saveRadialSlotsLocal(slots);
    setRadialSlots(normalized);
    try { await axios.put(`${API_URL}/auth/me/preferences`, { radial_slots: normalized }, { withCredentials: true }); } catch { /* offline */ }
  }, []);

  const resetRadialSlots = useCallback(() => persistRadialSlots(normalizeRadialSlots(null)), [persistRadialSlots]);

  const checkAuth = useCallback(async () => {
    // B2B portal uses URL token auth — do not call panel /auth/me
    if (getHostKind() === "b2b") {
      setLoading(false);
      return;
    }
    try {
      const res = await axios.get(`${API_URL}/auth/me`, { withCredentials: true });
      if (!res.data?.authenticated || !res.data.user) {
        setUser(null);
        setAuthenticated(false);
        setLicense(null);
        setCompanies([]);
        setActiveCompany(null);
        return;
      }
      const u = res.data.user;
      // Yalnızca çalışan (personel) app'te oturum açtıysa → ik self-servis
      if (
        getHostKind() === "app"
        && u?.employee_id
        && String(u?.role || "").toLowerCase() === "personel"
        && !u?.is_super_admin
      ) {
        window.location.replace(hostUrl("ik", "/personelim"));
        return;
      }
      setUser({ ...u, impersonation: res.data.impersonation || null });
      setAuthenticated(true);
      setLicense(res.data.license || null);
      if (res.data.user?.preferences?.module_order?.length) { setModuleOrder(res.data.user.preferences.module_order); localStorage.setItem("module_order", JSON.stringify(res.data.user.preferences.module_order)); }
      if (res.data.user?.preferences?.dashboard_layout?.length) {
        try { localStorage.setItem("dashboard_layout", JSON.stringify(res.data.user.preferences.dashboard_layout)); } catch { /* ignore */ }
      }
      if (Array.isArray(res.data.user?.preferences?.radial_slots)) {
        const slots = normalizeRadialSlots(res.data.user.preferences.radial_slots);
        setRadialSlots(slots);
        saveRadialSlotsLocal(slots);
      }
      setCompanies(res.data.companies || []);
      if (res.data.companies && res.data.companies.length > 0) {
        const found = res.data.companies.find(c => c.id === res.data.user?.active_company_id || c._id === res.data.user?.active_company_id);
        const active = found || res.data.companies[0];
        setActiveCompany(active);
        setPriceDecimals(active?.price_decimals);
      } else {
        setPriceDecimals(2);
      }
    } catch (err) {
      setUser(null);
      setAuthenticated(false);
      setLicense(null);
      setCompanies([]);
      setActiveCompany(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const applySession = useCallback((data) => {
    if (!data?.user) return;
    setUser(data.user);
    setAuthenticated(true);
    setLicense(data.license || null);
    setCompanies(data.companies || []);
    if (data.companies && data.companies.length > 0) {
      const found = data.companies.find((c) => c.id === data.user.active_company_id || c._id === data.user.active_company_id);
      const active = found || data.companies[0];
      setActiveCompany(active);
      setPriceDecimals(active?.price_decimals);
    }
  }, []);

  const login = useCallback(async (email, password, remember = true) => {
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { email, password, remember: !!remember }, { withCredentials: true });
      // Süper admin 2FA ikinci adımı — oturum açılmış sayma; ynt /sistem/giris
      if (res.data?.requires_2fa) {
        toast.message("İki adımlı doğrulama gerekli. Platform girişine yönlendiriliyorsunuz.");
        window.location.href = hostUrl("ynt", "/sistem/giris");
        return { ok: false, data: res.data };
      }
      // Employee on app → backend returns redirect to ik (no cookies)
      if (res.data?.redirect && !res.data?.token) {
        window.location.href = res.data.redirect;
        return { ok: false, data: res.data, redirect: res.data.redirect };
      }
      if (res.data?.user) {
        applySession(res.data);
        toast.success(`Hoş geldiniz, ${res.data.user.name}`);
      }
      return { ok: true, data: res.data, redirect: res.data?.redirect };
    } catch (err) {
      const msg = err.response?.data?.detail || "Giriş yapılamadı.";
      toast.error(typeof msg === "string" ? msg : (msg?.detail || "Giriş yapılamadı."));
      return { ok: false };
    }
  }, [applySession]);

  const switchCompany = useCallback(async (companyId) => {
    try {
      await axios.post(`${API_URL}/auth/switch-company`, { company_id: companyId }, { withCredentials: true });
      const comp = companies.find(c => (c.id === companyId || c._id === companyId));
      if (comp) {
        setActiveCompany(comp);
        setPriceDecimals(comp.price_decimals);
        try { const l = await axios.get(`${API_URL}/license/me`, { params: { company_id: companyId } }); setLicense(l.data); } catch { /* ignore */ }
        toast.success(`Aktif şirket değiştirildi: ${comp.name}`);
      }
    } catch (err) {
      toast.error("Şirket değiştirilemedi.");
    }
  }, [companies]);

  const logout = useCallback(async (to = "/login") => {
    try {
      await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true });
    } catch (e) {}
    setUser(null);
    setAuthenticated(false);
    setLicense(null);
    setCompanies([]);
    setActiveCompany(null);
    setPriceDecimals(2);
    toast.info("Oturum kapatıldı.");
    window.location.href = typeof to === "string" ? to : "/login";
  }, []);

  const refreshLicense = useCallback(async (cid) => {
    try {
      const company_id = cid || activeCompanyId(activeCompany);
      const l = await axios.get(`${API_URL}/license/me`, {
        params: company_id ? { company_id } : {},
      });
      setLicense(l.data);
    } catch { /* ignore */ }
  }, [activeCompany]);

  useEffect(() => {
    const onCompany = (ev) => {
      const doc = ev.detail;
      if (!doc) return;
      const id = doc.id || doc._id;
      setCompanies((prev) => prev.map((c) => ((c.id || c._id) === id ? { ...c, ...doc } : c)));
      setActiveCompany((prev) => {
        if (!prev || (prev.id || prev._id) !== id) return prev;
        return { ...prev, ...doc };
      });
      setPriceDecimals(doc.price_decimals);
    };
    window.addEventListener("tamkobi-company-updated", onCompany);
    return () => window.removeEventListener("tamkobi-company-updated", onCompany);
  }, []);

  const value = useMemo(() => ({
    user,
    authenticated,
    companies,
    activeCompany,
    switchCompany,
    login,
    applySession,
    logout,
    loading,
    menuItems,
    moveModule,
    moveModulePath,
    resetModuleOrder,
    radialSlots,
    persistRadialSlots,
    resetRadialSlots,
    can,
    permPath,
    feature,
    license,
    moduleOn,
    addonOn,
    reloadSession: checkAuth,
    refreshLicense,
  }), [
    user,
    authenticated,
    companies,
    activeCompany,
    switchCompany,
    login,
    applySession,
    logout,
    loading,
    menuItems,
    moveModule,
    moveModulePath,
    resetModuleOrder,
    radialSlots,
    persistRadialSlots,
    resetRadialSlots,
    can,
    feature,
    license,
    moduleOn,
    addonOn,
    checkAuth,
    refreshLicense,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
