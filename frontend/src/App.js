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
import AIAssistantPage from "./pages/AIAssistantPage";
import CommunicationPage from "./pages/CommunicationPage";

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
            <Route path="/ai-advisor" element={<AIAssistantPage />} />
            <Route path="/communication" element={<CommunicationPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MainLayout>
      </BrowserRouter>
    </AuthProvider>
  );
}
