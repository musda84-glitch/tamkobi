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
const DispatchesPage = () => <InvoicesPage initialType="dispatch" lockType />;

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
        <MainLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
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
            <Route path="/projects" element={<ProjectsPage />} />
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
            <Route path="/sistem" element={<SystemAdminPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MainLayout>
      </BrowserRouter>
    </AuthProvider>
  );
}
