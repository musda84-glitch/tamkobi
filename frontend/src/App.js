
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { Toaster } from "sonner";
import MainLayout from "./components/MainLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import SetupGuard from "./components/SetupGuard";
import Dashboard from "./pages/Dashboard";
import InvoicesPage from "./pages/InvoicesPage";
import ContactsPage from "./pages/ContactsPage";
import BankingPage from "./pages/BankingPage";
import StockBarcodePage from "./pages/StockBarcodePage";
import QuickSalePage from "./pages/QuickSalePage";
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
import AccountPage from "./pages/AccountPage";
import ProjectsPage from "./pages/ProjectsPage";
import InstallmentsPage from "./pages/InstallmentsPage";
import QuoteApprovalPage from "./pages/QuoteApprovalPage";
import ProjectTrackingPage from "./pages/ProjectTrackingPage";
import ShopFloorPage from "./pages/ShopFloorPage";
import StockCountKioskPage from "./pages/StockCountKioskPage";
import OrderPickKioskPage from "./pages/OrderPickKioskPage";
import ReportsPage from "./pages/ReportsPage";
import B2BPortalPage from "./pages/B2BPortalPage";
import AccountantPage from "./pages/AccountantPage";
import InviteAcceptPage from "./pages/InviteAcceptPage";
import LoginPage from "./pages/LoginPage";
import ExpensesPage from "./pages/ExpensesPage";
import LoansPage from "./pages/LoansPage";
import ChequesPage from "./pages/ChequesPage";
import TrashPage from "./pages/TrashPage";
import EdocInboxPage from "./pages/EdocInboxPage";
import SupportPage from "./pages/SupportPage";
import SystemAdminPage from "./pages/SystemAdminPage";
import SystemLoginPage from "./pages/SystemLoginPage";
import WebsiteAdminPage from "./pages/WebsiteAdminPage";
import PricingPage from "./pages/PricingPage";
import HomeOrApp from "./pages/HomeOrApp";
import SetupPage from "./pages/SetupPage";
import SignupPage from "./pages/SignupPage";
import LegalPage from "./pages/LegalPage";
import PaymentResultPage from "./pages/PaymentResultPage";
import RenewPage from "./pages/RenewPage";
import B2BLoginPage from "./pages/B2BLoginPage";
import B2BResetPage from "./pages/B2BResetPage";
import B2BAdminPage from "./pages/B2BAdminPage";
import FieldSalesPage from "./pages/FieldSalesPage";
import TradePage from "./pages/TradePage";

const DispatchesPage = () => <InvoicesPage initialType="dispatch" lockType />;

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
        <SetupGuard>
        <MainLayout>
          <ProtectedRoute>
          <Routes>
            <Route path="/" element={<HomeOrApp />} />
            <Route path="/kurulum" element={<SetupPage />} />
            <Route path="/panel" element={<Dashboard />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/dis-ticaret" element={<TradePage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/banking" element={<BankingPage />} />
            <Route path="/stock" element={<StockBarcodePage />} />
            <Route path="/hizli-satis" element={<QuickSalePage />} />
            <Route path="/ecommerce" element={<EcommercePage />} />
            <Route path="/cargo" element={<CargoPage />} />
            <Route path="/orders" element={<OrdersB2BPage />} />
            <Route path="/saha" element={<FieldSalesPage />} />
            <Route path="/warehouses" element={<WarehousePage />} />
            <Route path="/production" element={<ProductionPage />} />
            <Route path="/personnel" element={<PersonnelPage />} />
            <Route path="/mesai" element={<MyAttendancePage />} />
            <Route path="/ai-advisor" element={<AIAssistantPage />} />
            <Route path="/communication" element={<CommunicationPage />} />
            <Route path="/hesap" element={<AccountPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/quotes" element={<ProjectsPage section="quotes" />} />
            <Route path="/projects" element={<ProjectsPage section="projects" />} />
            <Route path="/surveys" element={<ProjectsPage section="surveys" />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/accountant" element={<AccountantPage />} />
            <Route path="/installments" element={<InstallmentsPage />} />
            <Route path="/teklif/:token" element={<QuoteApprovalPage />} />
            <Route path="/proje/:token" element={<ProjectTrackingPage />} />
            <Route path="/atolye" element={<ShopFloorPage />} />
            <Route path="/sayim" element={<StockCountKioskPage />} />
            <Route path="/sevk" element={<OrderPickKioskPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/portal" element={<Navigate to="/b2b/giris" replace />} />
            <Route path="/portal/:token" element={<B2BPortalPage />} />
            <Route path="/davet/:token" element={<InviteAcceptPage />} />
            <Route path="/dispatches" element={<DispatchesPage />} />
            <Route path="/expenses" element={<ExpensesPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/cheques" element={<ChequesPage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/edoc-inbox" element={<EdocInboxPage />} />
            <Route path="/sistem/giris" element={<SystemLoginPage />} />
            <Route path="/sistem/web" element={<WebsiteAdminPage />} />
            <Route path="/sistem" element={<SystemAdminPage section="" />} />
            <Route path="/sistem/sirketler" element={<SystemAdminPage section="sirketler" />} />
            <Route path="/sistem/kullanicilar" element={<SystemAdminPage section="kullanicilar" />} />
            <Route path="/sistem/paketler" element={<SystemAdminPage section="paketler" />} />
            <Route path="/sistem/moduller" element={<SystemAdminPage section="moduller" />} />
            <Route path="/sistem/talepler" element={<SystemAdminPage section="talepler" />} />
            <Route path="/sistem/odemeler" element={<SystemAdminPage section="odemeler" />} />
            <Route path="/sistem/hatirlatmalar" element={<SystemAdminPage section="hatirlatmalar" />} />
            <Route path="/sistem/ayarlar" element={<SystemAdminPage section="ayarlar" />} />
            <Route path="/sistem/:section" element={<SystemAdminPage />} />
            <Route path="/web" element={<PricingPage />} />
            <Route path="/fiyatlar" element={<Navigate to="/web" replace />} />
            <Route path="/kayit" element={<SignupPage />} />
            <Route path="/yasal/:slug" element={<LegalPage />} />
            <Route path="/odeme/basarili" element={<PaymentResultPage />} />
            <Route path="/odeme/iptal" element={<PaymentResultPage />} />
            <Route path="/yenile/:token" element={<RenewPage />} />
            <Route path="/b2b/giris" element={<B2BLoginPage />} />
            <Route path="/b2b/sifre/:token" element={<B2BResetPage />} />
            <Route path="/b2b-yonetim" element={<B2BAdminPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ProtectedRoute>
        </MainLayout>
        </SetupGuard>
      </BrowserRouter>
    </AuthProvider>
  );
}
