import React, { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";

const AuthContext = createContext(null);

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const API_URL = `${BACKEND_URL}/api`;
axios.defaults.withCredentials = true;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [license, setLicense] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [activeCompany, setActiveCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moduleOrder, setModuleOrder] = useState(() => { try { return JSON.parse(localStorage.getItem("module_order") || "[]"); } catch { return []; } });

  const BASE_MENU = [
    { label: "Genel Bakış", path: "/" },
    { label: "Faturalar", path: "/invoices", badge: "GİB" },
    { label: "Gelen e-Belgeler", path: "/edoc-inbox", badge: "Kutu" },
    { label: "B2B Portal Yönetimi", path: "/b2b-yonetim", badge: "Bayi" },
    { label: "İrsaliyeler", path: "/dispatches", badge: "e-İrsaliye" },
    { label: "Masraflar", path: "/expenses", badge: "Gider" },
    { label: "Krediler", path: "/loans", badge: "Banka" },
    { label: "Cari Hesaplar", path: "/contacts" },
    { label: "Taksitler", path: "/installments", badge: "Vade" },
    { label: "Raporlar", path: "/reports", badge: "Excel" },
    { label: "Banka & Kasa & POS", path: "/banking" },
    { label: "Stoklar & Ürünler", path: "/stock", badge: "Barkod" },
    { label: "Teklif / Proje / Keşif", path: "/projects", badge: "Yeni" },
    { label: "E-Ticaret Entegrasyon", path: "/ecommerce", badge: "Trendyol" },
    { label: "Kargo Entegrasyon", path: "/cargo", badge: "Yurtiçi" },
    { label: "Siparişler", path: "/orders", badge: "B2B" },
    { label: "Depo & Transfer", path: "/warehouses" },
    { label: "Üretim & Reçete (BOM)", path: "/production" },
    { label: "Üretim Ekranı (Atölye)", path: "/atolye", badge: "Tablet" },
    { label: "Personel & Bordro", path: "/personnel" },
    { label: "Mesaim", path: "/mesai", badge: "Puantaj" },
    { label: "İletişim: Mail & SMS", path: "/communication", badge: "Netgsm" },
    { label: "Nexus AI Danışman", path: "/ai-advisor", badge: "GPT-5.4", isAi: true },
    { label: "Mali Müşavir Paneli", path: "/accountant", badge: "KDV" },
    { label: "Firma Ayarları", path: "/settings" },
    { label: "Çöp Kutusu", path: "/trash", badge: "30 gün" },
  ];
  const LICENSE_KEY = { "/edoc-inbox": "/invoices", "/mesai": "/personnel", "/b2b-yonetim": "/contacts" };
  const perms = user?.permissions;
  const can = (path, level = "view") => !perms || user?.role === "admin" || (level === "view" ? perms[path] !== "none" : perms[path] === "edit");
  const feature = (key) => !user || user?.role === "admin" || !user?.features || user.features[key] !== false;
  const moduleOn = (path) => !license?.modules || license.modules[LICENSE_KEY[path] || path] !== false;
  const visible = (m) => (m.isSystem ? !!user?.is_super_admin : can(m.path) && moduleOn(m.path));
  const rank = (path) => {
    const i = moduleOrder.indexOf(path);
    if (i !== -1 || moduleOrder.length === 0) return i === -1 ? BASE_MENU.findIndex((m) => m.path === path) : i;
    const bi = BASE_MENU.findIndex((m) => m.path === path);
    for (let k = bi - 1; k >= 0; k--) { const j = moduleOrder.indexOf(BASE_MENU[k].path); if (j !== -1) return j + 0.5 + bi / 1000; }
    return -0.5 + bi / 1000;
  };
  const menuItems = BASE_MENU.filter(visible).sort((a, b) => rank(a.path) - rank(b.path));

  const persistOrder = async (order) => {
    setModuleOrder(order);
    localStorage.setItem("module_order", JSON.stringify(order));
    try { await axios.put(`${API_URL}/auth/me/preferences`, { module_order: order }, { withCredentials: true }); } catch { /* offline */ }
  };
  const moveModule = (from, to) => {
    if (to < 0 || to >= menuItems.length) return;
    const paths = menuItems.map((m) => m.path);
    const [moved] = paths.splice(from, 1);
    paths.splice(to, 0, moved);
    persistOrder(paths);
  };
  const resetModuleOrder = () => persistOrder([]);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await axios.get(`${API_URL}/auth/me`, { withCredentials: true });
      setUser({ ...res.data.user, impersonation: res.data.impersonation || null });
      setAuthenticated(!!res.data.authenticated);
      setLicense(res.data.license || null);
      if (res.data.user?.preferences?.module_order?.length) { setModuleOrder(res.data.user.preferences.module_order); localStorage.setItem("module_order", JSON.stringify(res.data.user.preferences.module_order)); }
      setCompanies(res.data.companies || []);
      if (res.data.companies && res.data.companies.length > 0) {
        const found = res.data.companies.find(c => c.id === res.data.user?.active_company_id || c._id === res.data.user?.active_company_id);
        setActiveCompany(found || res.data.companies[0]);
      }
    } catch (err) {
      console.log("No active session, default demo admin available");
      // Load fallback demo state
      setUser({
        id: "usr_admin_01",
        name: "Sarp Yılmaz (Genel Müdür)",
        email: "admin@nexus.com",
        role: "admin",
        active_company_id: "comp_nexus_main_01"
      });
      setActiveCompany({
        id: "comp_nexus_main_01",
        name: "Nexus Teknoloji ve E-Ticaret A.Ş.",
        tax_number: "6320984412",
        city: "İstanbul"
      });
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const res = await axios.post(`${API_URL}/auth/login`, { email, password }, { withCredentials: true });
      setUser(res.data.user);
      setAuthenticated(true);
      setLicense(res.data.license || null);
      setCompanies(res.data.companies || []);
      if (res.data.companies && res.data.companies.length > 0) {
        const found = res.data.companies.find(c => c.id === res.data.user.active_company_id || c._id === res.data.user.active_company_id);
        setActiveCompany(found || res.data.companies[0]);
      }
      toast.success(`Hoş geldiniz, ${res.data.user.name}`);
      return true;
    } catch (err) {
      const msg = err.response?.data?.detail || "Giriş yapılamadı.";
      toast.error(msg);
      return false;
    }
  };

  const switchCompany = async (companyId) => {
    try {
      await axios.post(`${API_URL}/auth/switch-company`, { company_id: companyId }, { withCredentials: true });
      const comp = companies.find(c => (c.id === companyId || c._id === companyId));
      if (comp) {
        setActiveCompany(comp);
        try { const l = await axios.get(`${API_URL}/license/me`, { params: { company_id: companyId } }); setLicense(l.data); } catch { /* ignore */ }
        toast.success(`Aktif şirket değiştirildi: ${comp.name}`);
      }
    } catch (err) {
      toast.error("Şirket değiştirilemedi.");
    }
  };

  const logout = async (to = "/login") => {
    try {
      await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true });
    } catch (e) {}
    setUser(null);
    toast.info("Oturum kapatıldı.");
    window.location.href = typeof to === "string" ? to : "/login";
  };

  return (
    <AuthContext.Provider value={{ user, authenticated, companies, activeCompany, switchCompany, login, logout, loading, menuItems, moveModule, resetModuleOrder, can, feature, license, moduleOn, reloadSession: checkAuth, refreshLicense: async (cid) => { try { const l = await axios.get(`${API_URL}/license/me`, { params: { company_id: cid || activeCompany?.id || activeCompany?._id || "comp_nexus_main_01" } }); setLicense(l.data); } catch { /* ignore */ } } }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
