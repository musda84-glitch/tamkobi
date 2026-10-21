import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { HelpProvider } from "./context/HelpContext";
import { HelpHost } from "./components/help/HelpHost";
import { PosSessionProvider } from "./context/PosSessionContext";
import { MesaimGateProvider } from "./context/MesaimGateContext";
import { Toaster } from "sonner";
import HostShell from "./components/HostShell";
import { PlatformDocumentBrand } from "./components/PlatformBrand";
import HostRouteGuard from "./components/HostRouteGuard";
import ProtectedRoute from "./components/ProtectedRoute";
import SetupGuard from "./components/SetupGuard";
import { PlatformNoticesHost } from "./components/PlatformNoticesHost";
import { CompanyEventBridge } from "./components/CompanyEventBridge";

/** İlk boyamada gereken hafif sayfalar — geri kalanı route bazlı chunk. */
import LoginPage from "./pages/LoginPage";
import HostHome from "./pages/HostHome";
import SetupPage from "./pages/SetupPage";

const page = (loader) => lazy(loader);

const Dashboard = page(() => import("./pages/Dashboard"));
const InvoicesPage = page(() => import("./pages/InvoicesPage"));
const ContactsPage = page(() => import("./pages/ContactsPage"));
const BankingPage = page(() => import("./pages/BankingPage"));
const StockBarcodePage = page(() => import("./pages/StockBarcodePage"));
const QuickSalePage = page(() => import("./pages/QuickSalePage"));
const EcommercePage = page(() => import("./pages/EcommercePage"));
const CargoPage = page(() => import("./pages/CargoPage"));
const OrdersB2BPage = page(() => import("./pages/OrdersB2BPage"));
const PurchaseOrdersPage = page(() => import("./pages/PurchaseOrdersPage"));
const WarehousePage = page(() => import("./pages/WarehousePage"));
const ProductionPage = page(() => import("./pages/ProductionPage"));
const PersonnelPage = page(() => import("./pages/PersonnelPage"));
const MyAttendancePage = page(() => import("./pages/MyAttendancePage"));
const MyPersonnelPage = page(() => import("./pages/MyPersonnelPage"));
const AIAssistantPage = page(() => import("./pages/AIAssistantPage"));
const CommunicationPage = page(() => import("./pages/CommunicationPage"));
const SettingsPage = page(() => import("./pages/SettingsPage"));
const VposResultPage = page(() => import("./pages/VposResultPage"));
const AccountPage = page(() => import("./pages/AccountPage"));
const ProjectsPage = page(() => import("./pages/ProjectsPage"));
const InstallmentsPage = page(() => import("./pages/InstallmentsPage"));
const QuoteApprovalPage = page(() => import("./pages/QuoteApprovalPage"));
const ProjectTrackingPage = page(() => import("./pages/ProjectTrackingPage"));
const StatementPublicPage = page(() => import("./pages/StatementPublicPage"));
const ShopFloorPage = page(() => import("./pages/ShopFloorPage"));
const StockCountKioskPage = page(() => import("./pages/StockCountKioskPage"));
const OrderPickKioskPage = page(() => import("./pages/OrderPickKioskPage"));
const ReportsPage = page(() => import("./pages/ReportsPage"));
const B2BPortalPage = page(() => import("./pages/B2BPortalPage"));
const B2BCardResultPage = page(() => import("./pages/B2BCardResultPage"));
const AccountantPage = page(() => import("./pages/AccountantPage"));
const InviteAcceptPage = page(() => import("./pages/InviteAcceptPage"));
const ExpensesPage = page(() => import("./pages/ExpensesPage"));
const LoansPage = page(() => import("./pages/LoansPage"));
const ChequesPage = page(() => import("./pages/ChequesPage"));
const VehiclesPage = page(() => import("./pages/VehiclesPage"));
const TrashPage = page(() => import("./pages/TrashPage"));
const CompanyAuditPage = page(() => import("./pages/CompanyAuditPage"));
const EdocInboxPage = page(() => import("./pages/EdocInboxPage"));
const SupportPage = page(() => import("./pages/SupportPage"));
const SystemAdminPage = page(() => import("./pages/SystemAdminPage"));
const CompanyDetailPage = page(() => import("./pages/CompanyDetailPage"));
const SystemLoginPage = page(() => import("./pages/SystemLoginPage"));
const System2FASetupPage = page(() => import("./pages/System2FASetupPage"));
const WebsiteAdminPage = page(() => import("./pages/WebsiteAdminPage"));
const PricingPage = page(() => import("./pages/PricingPage"));
const TaiSitePage = page(() => import("./pages/TaiSite"));
const SignupPage = page(() => import("./pages/SignupPage"));
const LegalPage = page(() => import("./pages/LegalPage"));
const NotFoundPage = page(() => import("./pages/NotFoundPage"));
const PaymentResultPage = page(() => import("./pages/PaymentResultPage"));
const RenewPage = page(() => import("./pages/RenewPage"));
const B2BLoginPage = page(() => import("./pages/B2BLoginPage"));
const B2BSupplierPickerPage = page(() => import("./pages/B2BSupplierPickerPage"));
const B2BResetPage = page(() => import("./pages/B2BResetPage"));
const ResetPasswordPage = page(() => import("./pages/ResetPasswordPage"));
const B2BAdminPage = page(() => import("./pages/B2BAdminPage"));
const FieldSalesPage = page(() => import("./pages/FieldSalesPage"));
const TradePage = page(() => import("./pages/TradePage"));
const SsoHandoffPage = page(() => import("./pages/SsoHandoffPage"));
const HelpCenterPage = page(() => import("./pages/HelpCenterPage"));

const DispatchesPage = () => <InvoicesPage initialType="dispatch" lockType />;

function RouteFallback() {
  return (
    <div
      className="min-h-[40vh] flex items-center justify-center text-slate-400 text-xs"
      data-testid="route-chunk-loading"
    >
      Sayfa yükleniyor…
    </div>
  );
}

/** Platform yönetim paneli duyuru yönetirken kendi pop-up'ını görmesin. */
function NoticesGate() {
  const { pathname } = useLocation();
  const disabled = pathname === "/sistem" || pathname.startsWith("/sistem/");
  return <PlatformNoticesHost disabled={disabled} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CompanyEventBridge />
        <HelpProvider>
        <PosSessionProvider>
        <MesaimGateProvider>
        <PlatformDocumentBrand />
        <Toaster position="top-right" richColors closeButton />
        <HelpHost />
        <NoticesGate />
        <SetupGuard>
          <HostRouteGuard>
          <HostShell>
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<HostHome />} />
                  <Route path="/kurulum" element={<SetupPage />} />
                  <Route path="/panel" element={<Dashboard />} />
                  <Route path="/yardim" element={<HelpCenterPage />} />
                  <Route path="/invoices" element={<InvoicesPage />} />
                  <Route path="/dis-ticaret" element={<TradePage />} />
                  <Route path="/contacts" element={<ContactsPage />} />
                  <Route path="/banking" element={<BankingPage />} />
                  <Route path="/stock" element={<StockBarcodePage />} />
                  <Route path="/hizli-satis" element={<QuickSalePage />} />
                  <Route path="/ecommerce" element={<EcommercePage />} />
                  <Route path="/cargo" element={<CargoPage />} />
                  <Route path="/orders" element={<OrdersB2BPage />} />
                  <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
                  <Route path="/saha" element={<FieldSalesPage />} />
                  <Route path="/warehouses" element={<WarehousePage />} />
                  <Route path="/vehicles" element={<VehiclesPage />} />
                  <Route path="/production" element={<ProductionPage />} />
                  <Route path="/personnel" element={<PersonnelPage />} />
                  <Route path="/personelim" element={<MyPersonnelPage />} />
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
                  <Route path="/ekstre/:token" element={<StatementPublicPage />} />
                  <Route path="/atolye" element={<ShopFloorPage />} />
                  <Route path="/sayim" element={<StockCountKioskPage />} />
                  <Route path="/sevk" element={<OrderPickKioskPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/portal/:token/odeme/:intentId" element={<B2BCardResultPage />} />
                  <Route path="/portal/:token/*" element={<B2BPortalPage />} />
                  <Route path="/davet/:token" element={<InviteAcceptPage />} />
                  <Route path="/dispatches" element={<DispatchesPage />} />
                  <Route path="/expenses" element={<ExpensesPage />} />
                  <Route path="/loans" element={<LoansPage />} />
                  <Route path="/cheques" element={<ChequesPage />} />
                  <Route path="/trash" element={<TrashPage />} />
                  <Route path="/islem-gecmisi" element={<CompanyAuditPage />} />
                  <Route path="/edoc-inbox" element={<EdocInboxPage />} />
                  <Route path="/sistem/giris" element={<SystemLoginPage />} />
                  <Route path="/sistem/2fa-kurulum" element={<System2FASetupPage />} />
                  <Route path="/sistem/web" element={<WebsiteAdminPage />} />
                  <Route path="/sistem" element={<SystemAdminPage section="" />} />
                  <Route path="/sistem/sirketler/:companyId" element={<CompanyDetailPage />} />
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
                  <Route path="/hakkimizda" element={<TaiSitePage />} />
                  <Route path="/hizmetler" element={<TaiSitePage />} />
                  <Route path="/referanslar" element={<TaiSitePage />} />
                  <Route path="/iletisim" element={<TaiSitePage />} />
                  <Route path="/fiyatlar" element={<Navigate to="/web" replace />} />
                  <Route path="/kayit" element={<SignupPage />} />
                  <Route path="/yasal/:slug" element={<LegalPage />} />
                  <Route path="/vpos/result/:id" element={<VposResultPage />} />
                  <Route path="/odeme/basarili" element={<PaymentResultPage />} />
                  <Route path="/odeme/iptal" element={<PaymentResultPage />} />
                  <Route path="/yenile/:token" element={<RenewPage />} />
                  <Route path="/b2b/giris" element={<B2BLoginPage />} />
                  <Route path="/b2b/tedarikci" element={<B2BSupplierPickerPage />} />
                  <Route path="/b2b/sifre/:token" element={<B2BResetPage />} />
                  <Route path="/sifre/:token" element={<ResetPasswordPage />} />
                  <Route path="/b2b-yonetim" element={<B2BAdminPage />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/sso" element={<SsoHandoffPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </ProtectedRoute>
          </HostShell>
          </HostRouteGuard>
        </SetupGuard>
        </MesaimGateProvider>
        </PosSessionProvider>
        </HelpProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
