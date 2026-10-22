import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { confirmAction } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, Empty, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { countIdOf, scannedItems, stockCountCreatePayload, warehouseSelectGroups, type CountListRow, type WarehouseOption } from "../utils/stockCount";

export function StockCountScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/sayim", "edit");
  const canView = can("/sayim");
  const [rows, setRows] = useState<CountListRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [name, setName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const [data, deps] = await Promise.all([
        get<CountListRow[]>(client, "/warehouses/stock-counts", { company_id: companyId }),
        get<WarehouseOption[]>(client, "/warehouses", { company_id: companyId }).catch(() => []),
      ]);
      setRows(Array.isArray(data) ? data : []);
      setWarehouses(Array.isArray(deps) ? deps : []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Sayımlar yüklenemedi."));
    }
  }, [canView, client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = () => {
    if (!canEdit) return;
    const depot = warehouses.find((w) => String(w.id || w._id || "") === warehouseId);
    const where = depot?.name ? ` (${depot.name})` : " (tüm depolar)";
    confirmAction("Yeni sayım", `Boş sayım oturumu açılsın mı?${where}`, async () => {
      setBusy(true);
      try {
        const created = await post<CountListRow>(client, "/warehouses/stock-counts", stockCountCreatePayload(companyId, name, warehouseId));
        setName("");
        setWarehouseId("");
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
      <Muted>Barkod okutun: dokununca tek, basılı tutunca seri. Adet çarpanı geçerlidir.</Muted>
      <ErrorBanner message={error} />

      {canEdit ? (
        <Card testID="sayim-new-card">
          <Field label="Sayım adı (opsiyonel)" testID="sayim-name" value={name} onChangeText={setName} placeholder="Örn: Depo A — akşam" />
          <GroupedSelect
            label="Depo"
            testID="sayim-warehouse"
            value={warehouseId}
            onChange={setWarehouseId}
            groups={warehouseSelectGroups(warehouses)}
            emptyLabel="Tüm depolar"
          />
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
