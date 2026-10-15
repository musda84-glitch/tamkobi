import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import {
  isEinvoiceConfigured,
  shouldShowEinvoiceUnconfiguredWarning,
} from "../utils/einvoiceIntegrator";

/**
 * Firma e-belge entegratörü (GET /einvoice/settings).
 * Faturalar ve aynı uyarıyı basan ekranlar bunu kullanır; settings null
 * iken "bağlı değil" sayılmaz — loading bitene kadar uyarı kapalıdır.
 */
export function useEinvoiceIntegrator(companyId) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) {
      setSettings(null);
      setLoading(true);
      return undefined;
    }
    let cancel = false;
    setLoading(true);
    axios
      .get(`${API_URL}/einvoice/settings`, { params: { company_id: companyId } })
      .then((r) => {
        if (cancel) return;
        const data = r?.data;
        setSettings(data && typeof data === "object" ? data : null);
        setLoading(false);
      })
      .catch(() => {
        if (cancel) return;
        setSettings(null);
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [companyId]);

  return {
    settings,
    loading,
    configured: !loading && isEinvoiceConfigured(settings),
    showUnconfiguredWarning: shouldShowEinvoiceUnconfiguredWarning({ loading, settings }),
  };
}
