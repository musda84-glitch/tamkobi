import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Üretim / proje özeti. 404, hata ve boş yanıtta null. Yetki yoksa istek atılmaz. */
export function useManagerSummary(companyId, enabled) {
  const [data, setData] = useState(null);

  const load = useCallback(() => {
    if (!enabled || !companyId) {
      setData(null);
      return undefined;
    }
    let live = true;
    axios.get(`${API_URL}/dashboard/manager-summary?company_id=${encodeURIComponent(companyId)}`)
      .then((res) => {
        if (!live) return;
        const body = res?.data;
        if (!isRecord(body) || (!isRecord(body.production) && !isRecord(body.projects))) {
          setData(null);
          return;
        }
        setData(body);
      })
      .catch(() => {
        if (live) setData(null);
      });
    return () => { live = false; };
  }, [companyId, enabled]);

  useEffect(() => {
    setData(null);
    return load();
  }, [load]);
  useDataRefresh(load, { companyId, scopes: ["production", "orders", "all"] });
  return data;
}
