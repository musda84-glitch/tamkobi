import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { Card, Empty, ErrorBanner, Field, ListRow, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { idOf } from "../utils/money";
import {
  VEHICLE_STATUSES,
  filterVehicles,
  vehicleStatusLabel,
  vehicleTitle,
  type Vehicle,
} from "../utils/vehicles";

type VehicleList = {
  vehicles?: Vehicle[];
  summary?: { total?: number; active?: number; inactive?: number; maintenance?: number };
};

export function VehiclesScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/vehicles", "edit");
  const [data, setData] = useState<VehicleList>({ vehicles: [] });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await get<VehicleList>(client, "/vehicles", { company_id: companyId });
      setData(res || { vehicles: [] });
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Araç listesi yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rows = useMemo(() => filterVehicles(data.vehicles || [], status, q).slice(0, 100), [data.vehicles, q, status]);
  const s = data.summary;

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={(
        <>
          {canEdit ? (
            <PrimaryButton title="Yeni araç" onPress={() => go("VehicleNew")} color={colors.primary} testID="vehicle-new-btn" />
          ) : null}
          <Field label="Ara" testID="vehicle-search" value={q} onChangeText={setQ} placeholder="Plaka, marka, model" />
        </>
      )}
    >
      <ErrorBanner message={error} />
      {s ? (
        <Card testID="vehicles-summary">
          <Text style={{ fontWeight: "800", color: colors.text }}>Toplam {s.total ?? 0}</Text>
          <Row style={{ justifyContent: "space-between", marginTop: 4 }}>
            <MutedStat label="Aktif" value={s.active} />
            <MutedStat label="Pasif" value={s.inactive} />
            <MutedStat label="Bakım" value={s.maintenance} />
          </Row>
        </Card>
      ) : null}
      <Row style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <Chip compact label="Tümü" active={status === "all"} testID="vehicle-filter-all" onPress={() => setStatus("all")} />
        {VEHICLE_STATUSES.map((st) => (
          <Chip key={st.value} compact label={st.label} active={status === st.value} testID={`vehicle-filter-${st.value}`} onPress={() => setStatus(st.value)} />
        ))}
      </Row>
      {rows.length === 0 ? (
        <Empty icon="car-outline" title="Araç yok" hint={canEdit ? "Yeni araç ile filo kaydı ekleyin." : undefined} />
      ) : rows.map((row) => {
        const id = idOf(row);
        return (
          <ListRow
            key={id}
            testID={`vehicle-row-${id}`}
            title={vehicleTitle(row)}
            subtitle={[row.year ? String(row.year) : null, row.color, vehicleStatusLabel(row.status)].filter(Boolean).join(" · ")}
            onPress={() => go("VehicleDetail", { id })}
          />
        );
      })}
    </Screen>
  );
}

function MutedStat({ label, value }: { label: string; value?: number }) {
  return (
    <Text style={{ fontSize: 11, color: colors.muted }}>
      {label} <Text style={{ fontWeight: "700", color: colors.text }}>{value ?? 0}</Text>
    </Text>
  );
}
