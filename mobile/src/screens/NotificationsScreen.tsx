import React, { useCallback, useEffect, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Empty, ErrorBanner, ListRow, Screen } from "../components/kit";
import type { Notification } from "../types";
import { fmtDate, idOf } from "../utils/money";

export function NotificationsScreen() {
  const { client, companyId } = useAuth();
  const [rows, setRows] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await get<Notification[]>(client, "/notifications", { company_id: companyId });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Bildirimler yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  const mark = async (n: Notification) => {
    const id = idOf(n);
    if (!id || n.is_read) return;
    try {
      await post(client, `/notifications/${id}/read`, {});
      setRows((prev) => prev.map((x) => (idOf(x) === id ? { ...x, is_read: true } : x)));
    } catch {
      /* ignore */
    }
  };

  return (
    <Screen onRefresh={load}>
      <ErrorBanner message={error} />
      {!rows.length ? <Empty icon="notifications-outline" title="Bildirim yok" /> : rows.map((n) => (
        <ListRow
          key={idOf(n)}
          title={n.title || n.type || "Bildirim"}
          subtitle={`${n.message || n.body || ""} · ${fmtDate(n.created_at)}`}
          right={n.is_read ? "" : "Yeni"}
          onPress={() => mark(n)}
        />
      ))}
    </Screen>
  );
}
