import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";

/**
 * Sidebar sayı rozetleri: personel talepleri + onay bekleyen sipariş.
 * path → number (0 = gösterme)
 */
export function useNavCounts(companyId) {
  const [counts, setCounts] = useState({});

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const [pending, overview] = await Promise.all([
        axios.get(`${API_URL}/personnel/pending-requests`, { params: { company_id: companyId } }).catch(() => null),
        axios.get(`${API_URL}/dashboard/overview`, { params: { company_id: companyId } }).catch(() => null),
      ]);
      const next = {};
      const pc = Number(pending?.data?.count || 0);
      if (pc > 0) next["/personnel"] = pc;
      const tasks = overview?.data?.tasks || [];
      const orders = tasks.find((t) => t.key === "pending_orders");
      if (orders?.count > 0) next["/orders"] = Number(orders.count);
      setCounts(next);
    } catch {
      /* ignore */
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);
  useDataRefresh(load, { companyId, scopes: ["personnel", "attendance", "orders"] });

  return counts;
}

export default useNavCounts;
