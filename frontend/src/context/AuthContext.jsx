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

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await axios.get(`${API_URL}/auth/me`, { withCredentials: true });
      setUser(res.data.user);
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
    <AuthContext.Provider value={{ user, companies, activeCompany, switchCompany, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
