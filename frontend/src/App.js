import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { Toaster } from "sonner";

import MainLayout from "./components/MainLayout";
import Dashboard from "./pages/Dashboard";
import InvoicesPage from "./pages/InvoicesPage";
import ContactsPage from "./pages/ContactsPage";
import BankingPage from "./pages/BankingPage";
import StockBarcodePage from "./pages/StockBarcodePage";
import EcommercePage from "./pages/EcommercePage";
import CargoPage from "./pages/CargoPage";
import OrdersB2BPage from "./pages/OrdersB2BPage";
import WarehousePage from "./pages/WarehousePage";
import ProductionPage from "./pages/ProductionPage";
import PersonnelPage from "./pages/PersonnelPage";
import MyAttendancePage from "./pages/MyAttendancePage";
import AIAssistantPage from "./pages/AIAssistantPage";
import CommunicationPage from "./pages/CommunicationPage";
import SettingsPage from "./pages/SettingsPage";
import ProjectsPage from "./pages/ProjectsPage";
import InstallmentsPage from "./pages/InstallmentsPage";
import QuoteApprovalPage from "./pages/QuoteApprovalPage";
import ShopFloorPage from "./pages/ShopFloorPage";
import ReportsPage from "./pages/ReportsPage";
import B2BPortalPage from "./pages/B2BPortalPage";
import AccountantPage from "./pages/AccountantPage";
import InviteAcceptPage from "./pages/InviteAcceptPage";
import LoginPage from "./pages/LoginPage";
import ExpensesPage from "./pages/ExpensesPage";
import LoansPage from "./pages/LoansPage";
import TrashPage from "./pages/TrashPage";
import EdocInboxPage from "./pages/EdocInboxPage";
import SystemAdminPage from "./pages/SystemAdminPage";
import SystemLoginPage from "./pages/SystemLoginPage";
import PricingPage from "./pages/PricingPage";
import HomeOrApp from "./pages/HomeOrApp";
import SignupPage from "./pages/SignupPage";
import PaymentResultPage from "./pages/PaymentResultPage";
import RenewPage from "./pages/RenewPage";
import B2BLoginPage from "./pages/B2BLoginPage";
import B2BResetPage from "./pages/B2BResetPage";
import B2BAdminPage from "./pages/B2BAdminPage";
const DispatchesPage = () => <InvoicesPage initialType="dispatch" lockType />;

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
        <MainLayout>
          <Routes>
            <Route path="/" element={<HomeOrApp />} />
            <Route path="/panel" element={<Dashboard />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/banking" element={<BankingPage />} />
            <Route path="/stock" element={<StockBarcodePage />} />
            <Route path="/ecommerce" element={<EcommercePage />} />
            <Route path="/cargo" element={<CargoPage />} />
            <Route path="/orders" element={<OrdersB2BPage />} />
            <Route path="/warehouses" element={<WarehousePage />} />
            <Route path="/production" element={<ProductionPage />} />
            <Route path="/personnel" element={<PersonnelPage />} />
            <Route path="/mesai" element={<MyAttendancePage />} />
            <Route path="/ai-advisor" element={<AIAssistantPage />} />
            <Route path="/communication" element={<CommunicationPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/quotes" element={<ProjectsPage section="quotes" />} />
            <Route path="/projects" element={<ProjectsPage section="projects" />} />
            <Route path="/surveys" element={<ProjectsPage section="surveys" />} />
            <Route path="/accountant" element={<AccountantPage />} />
            <Route path="/installments" element={<InstallmentsPage />} />
            <Route path="/teklif/:token" element={<QuoteApprovalPage />} />
            <Route path="/atolye" element={<ShopFloorPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/portal/:token" element={<B2BPortalPage />} />
            <Route path="/davet/:token" element={<InviteAcceptPage />} />
            <Route path="/dispatches" element={<DispatchesPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/edoc-inbox" element={<EdocInboxPage />} />
            <Route path="/sistem/giris" element={<SystemLoginPage />} />
            <Route path="/sistem/web" element={<SystemAdminPage />} />
            <Route path="/sistem" element={<SystemAdminPage />} />
            <Route path="/sistem/:section" element={<SystemAdminPage />} />
            <Route path="/fiyatlar" element={<PricingPage />} />
            <Route path="/kayit" element={<SignupPage />} />
            <Route path="/odeme/basarili" element={<PaymentResultPage />} />
            <Route path="/odeme/iptal" element={<PaymentResultPage />} />
            <Route path="/yenile/:token" element={<RenewPage />} />
            <Route path="/b2b/giris" element={<B2BLoginPage />} />
            <Route path="/b2b/sifre/:token" element={<B2BResetPage />} />
            <Route path="/b2b-yonetim" element={<B2BAdminPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MainLayout>
      </BrowserRouter>
    </AuthProvider>
  );
}
