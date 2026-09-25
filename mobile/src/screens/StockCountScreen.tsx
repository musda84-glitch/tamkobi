import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { confirmAction } from "../components/chips";
import { Card, Empty, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { countIdOf, scannedItems, type CountListRow } from "../utils/stockCount";

export function StockCountScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/sayim", "edit") || can("/stock", "edit");
  const canView = can("/sayim") || can("/stock");
  const [rows, setRows] = useState<CountListRow[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const data = await get<CountListRow[]>(client, "/warehouses/stock-counts", { company_id: companyId });
      setRows(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Sayımlar yüklenemedi."));
    }
  }, [canView, client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = () => {
    if (!canEdit) return;
    confirmAction("Yeni sayım", "Boş sayım oturumu açılsın mı?", async () => {
      setBusy(true);
      try {
        const created = await post<CountListRow>(client, "/warehouses/stock-counts", {
          company_id: companyId,
          name: name.trim() || undefined,
          preload_all: false,
        });
        setName("");
        setError(null);
        const id = countIdOf(created);
        if (id) go("StockCountSession", { id, name: created.name || "Sayım" });
        else await load();
      } catch (err) {
        setError(apiErrorMessage(err, "Sayım açılamadı."));
      } finally {
        setBusy(false);
      }
    });
  };

  const openRows = rows.filter((r) => r.status === "open");
  const doneRows = rows.filter((r) => r.status !== "open");

  if (!canView) {
    return (
      <Screen>
        <H1>Stok Sayımı</H1>
        <ErrorBanner message="Sayım yetkiniz yok." />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={load}>
      <H1>Stok Sayımı</H1>
      <Muted>Barkod okutun, adet çarpanı ve seri okuma ile sayın.</Muted>
      <ErrorBanner message={error} />

      {canEdit ? (
        <Card testID="sayim-new-card">
          <Field label="Sayım adı (opsiyonel)" testID="sayim-name" value={name} onChangeText={setName} placeholder="Örn: Depo A — akşam" />
          <PrimaryButton title="Yeni sayım başlat" onPress={create} loading={busy} color={colors.indigo} testID="sayim-create" />
        </Card>
      ) : null}

      <Card testID="sayim-open-list">
        <Muted>Açık oturumlar</Muted>
        {!openRows.length ? <Empty icon="clipboard-outline" title="Açık sayım yok" hint="Yeni sayım başlatın." /> : null}
        {openRows.map((r) => {
          const id = countIdOf(r);
          const counted = scannedItems(r).length;
          return (
            <ListRow
              key={id}
              title={r.name || "Sayım"}
              subtitle={`${r.warehouse_name || "Depo"} · ${counted} kalem sayıldı`}
              testID={`sayim-open-${id}`}
              onPress={() => go("StockCountSession", { id, name: r.name || "Sayım" })}
            />
          );
        })}
      </Card>

      {doneRows.length ? (
        <Card>
          <Muted>Tamamlanan ({doneRows.length})</Muted>
          {doneRows.slice(0, 8).map((r) => (
            <ListRow
              key={countIdOf(r)}
              title={r.name || "Sayım"}
              subtitle={r.warehouse_name || "—"}
              testID={`sayim-done-${countIdOf(r)}`}
              onPress={() => go("StockCountSession", { id: countIdOf(r), name: r.name || "Sayım" })}
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
