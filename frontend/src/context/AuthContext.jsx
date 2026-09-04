import React, { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";

const AuthContext = createContext(null);

export const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
export const API_URL = `${BACKEND_URL}/api`;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [activeCompany, setActiveCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [moduleOrder, setModuleOrder] = useState(() => { try { return JSON.parse(localStorage.getItem("module_order") || "[]"); } catch { return []; } });

  const BASE_MENU = [
    { label: "Genel Bakış", path: "/" },
    { label: "Faturalar", path: "/invoices", badge: "GİB" },
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
    { label: "İletişim: Mail & SMS", path: "/communication", badge: "Netgsm" },
    { label: "Nexus AI Danışman", path: "/ai-advisor", badge: "GPT-5.4", isAi: true },
    { label: "Mali Müşavir Paneli", path: "/accountant", badge: "KDV" },
    { label: "Firma Ayarları", path: "/settings" },
  ];
  const menuItems = [...BASE_MENU].sort((a, b) => { const ia = moduleOrder.indexOf(a.path), ib = moduleOrder.indexOf(b.path); return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib); });

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
      setUser(res.data.user);
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
        toast.success(`Aktif şirket değiştirildi: ${comp.name}`);
      }
    } catch (err) {
      toast.error("Şirket değiştirilemedi.");
    }
  };

  const logout = async () => {
    try {
      await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true });
    } catch (e) {}
    setUser(null);
    toast.info("Oturum kapatıldı.");
  };

  return (
    <AuthContext.Provider value={{ user, companies, activeCompany, switchCompany, login, logout, loading, menuItems, moveModule, resetModuleOrder }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
