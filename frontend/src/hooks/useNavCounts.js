import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";

/**
 * Sidebar sayı rozetleri: personel talepleri + yeni/onay bekleyen sipariş.
 * path → number (0 = gösterme)
 */
export function useNavCounts(companyId) {
  const [counts, setCounts] = useState({});

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const params = { company_id: companyId };
      const [pending, overview, ops] = await Promise.all([
        axios.get(`${API_URL}/personnel/pending-requests`, { params }).catch(() => null),
        axios.get(`${API_URL}/dashboard/overview`, { params }).catch(() => null),
        axios.get(`${API_URL}/dashboard/ops-alerts`, { params }).catch(() => null),
      ]);
      const next = {};
      const pc = Number(pending?.data?.count || 0);
      if (pc > 0) next["/personnel"] = pc;

      const tasks = overview?.data?.tasks || [];
      const pendingOrders = Number(tasks.find((t) => t.key === "pending_orders")?.count || 0);
      const newOrders = Number((ops?.data?.groups || []).find((g) => g.key === "new_orders")?.count || 0);
      const orderCount = Math.max(pendingOrders, newOrders);
      if (orderCount > 0) next["/orders"] = orderCount;

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
