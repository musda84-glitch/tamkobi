import React, { useState } from "react";
import axios from "axios";
import { FileText, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";

/**
 * Sipariş detayı / fatura önizleme için e-Fatura işlem paneli.
 * POST /api/e-invoice/create — order_id ve/veya invoice_id + company_id + scenario.
 */
const InvoiceActionPanel = ({
  orderId,
  invoiceId,
  companyId,
  defaultScenario = "TICARI",
  defaultEType = "e_invoice",
  alreadyIssued = false,
  onInvoiceCreated,
  className = "",
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [scenario, setScenario] = useState(defaultScenario === "TEMEL" ? "TEMEL" : "TICARI");
  const [eType, setEType] = useState(defaultEType || "e_invoice");

  const handleCreateInvoice = async () => {
    if (!orderId && !invoiceId) {
      setError("Sipariş veya fatura kimliği gerekli.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const body = {
        scenario: eType === "e_invoice" ? scenario : undefined,
        e_type: eType,
      };
      if (orderId) body.order_id = orderId;
      if (invoiceId) body.invoice_id = invoiceId;
      if (companyId) body.company_id = companyId;

      const response = await axios.post(`${API_URL}/e-invoice/create`, body);
      const num = response.data?.invoice_number || response.data?.gib_uuid || "—";
      setSuccessMsg(`E-Fatura başarıyla oluşturuldu! Fatura No: ${num}`);
      if (onInvoiceCreated) onInvoiceCreated(response.data);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Fatura oluşturulurken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  if (alreadyIssued) {
    return (
      <div className={`p-4 bg-emerald-50/80 rounded-xl border border-emerald-200 ${className}`} data-testid="invoice-action-panel-done">
        <h3 className="text-sm font-semibold text-emerald-800 mb-1">E-Fatura İşlemleri</h3>
        <p className="text-xs text-emerald-700">Bu belge için e-fatura zaten kesilmiş / GİB’e iletilmiş.</p>
      </div>
    );
  }

  return (
    <div className={`p-4 bg-white rounded-xl shadow-sm border border-slate-200 ${className}`} data-testid="invoice-action-panel">
      <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
        <FileText className="w-4 h-4 text-emerald-600" />
        E-Fatura İşlemleri
      </h3>

      {error && (
        <div className="mb-3 p-3 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg" data-testid="invoice-action-error">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mb-3 p-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg" data-testid="invoice-action-success">
          {successMsg}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <label className="text-[11px] text-slate-600 flex flex-col gap-0.5">
          Belge türü
          <select
            value={eType}
            onChange={(e) => setEType(e.target.value)}
            disabled={loading}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium"
            data-testid="invoice-action-etype"
          >
            <option value="e_invoice">E-Fatura</option>
            <option value="e_archive">E-Arşiv</option>
            <option value="paper">Kağıt</option>
          </select>
        </label>
        {eType === "e_invoice" && (
          <label className="text-[11px] text-slate-600 flex flex-col gap-0.5">
            Senaryo
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              disabled={loading}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-medium"
              data-testid="invoice-action-scenario"
            >
              <option value="TICARI">Ticari</option>
              <option value="TEMEL">Temel</option>
            </select>
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={handleCreateInvoice}
        disabled={loading || (!orderId && !invoiceId)}
        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition"
        data-testid="invoice-action-submit"
      >
        {loading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            GİB’e Gönderiliyor…
          </>
        ) : (
          "E-Fatura Kes / Gönder"
        )}
      </button>
    </div>
  );
};

export default InvoiceActionPanel;
