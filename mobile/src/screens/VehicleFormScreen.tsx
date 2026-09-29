import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, confirmAction } from "../components/chips";
import { Card, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import {
  VEHICLE_STATUSES,
  draftFromVehicle,
  emptyVehicleDraft,
  validateVehicleDraft,
  vehiclePayload,
  vehicleTitle,
  type Vehicle,
  type VehicleDraft,
} from "../utils/vehicles";

export function VehicleFormScreen({ vehicleId }: { vehicleId?: string }) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/vehicles", "edit");
  const canDelete = can("/vehicles", "delete");
  const isNew = !vehicleId;
  const [draft, setDraft] = useState<VehicleDraft>(emptyVehicleDraft);
  const [loaded, setLoaded] = useState<Vehicle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const set = <K extends keyof VehicleDraft>(key: K, value: VehicleDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const load = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const row = await get<Vehicle>(client, `/vehicles/${vehicleId}`);
      setLoaded(row);
      setDraft(draftFromVehicle(row));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Araç yüklenemedi."));
    }
  }, [client, vehicleId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const invalid = validateVehicleDraft(draft);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Araç kaydı yetkiniz yok."); return; }
    setBusy(true);
    try {
      const body = vehiclePayload(draft, companyId || "");
      if (isNew) {
        const r = await post<{ message?: string; id?: string }>(client, "/vehicles", body);
        setMessage(r.message || "Araç kaydedildi.");
        if (r.id) router.replace(`/vehicles/${r.id}`);
        else router.replace("/vehicles");
      } else {
        const r = await put<{ message?: string }>(client, `/vehicles/${vehicleId}`, body);
        setMessage(r.message || "Araç güncellendi.");
        await load();
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Araç kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!vehicleId || !canDelete) {
      setError("Silme yetkiniz yok.");
      return;
    }
    confirmAction("Araçı sil", `${vehicleTitle(loaded || draft)} çöp kutusuna taşınsın mı?`, async () => {
      setBusy(true);
      try {
        const r = await del<{ message?: string }>(client, `/vehicles/${vehicleId}`);
        setMessage(r.message || "Araç silindi.");
        router.replace("/vehicles");
      } catch (err) {
        setError(apiErrorMessage(err, "Silinemedi."));
      } finally {
        setBusy(false);
      }
    });
  };

  return (
    <Screen>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      <Card>
        <Field label="Plaka *" testID="vehicle-plate" value={draft.plate} onChangeText={(v) => set("plate", v)} autoCapitalize="characters" editable={canEdit} placeholder="34 ABC 123" />
        <Field label="Marka" testID="vehicle-brand" value={draft.brand} onChangeText={(v) => set("brand", v)} editable={canEdit} />
        <Field label="Model" testID="vehicle-model" value={draft.model} onChangeText={(v) => set("model", v)} editable={canEdit} />
        <Field label="Model yılı" testID="vehicle-year" value={draft.year} onChangeText={(v) => set("year", v)} keyboardType="number-pad" editable={canEdit} />
        <Field label="Renk" testID="vehicle-color" value={draft.color} onChangeText={(v) => set("color", v)} editable={canEdit} />
        <Muted>Durum</Muted>
        <Row style={{ gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {VEHICLE_STATUSES.map((st) => (
            <Chip
              key={st.value}
              compact
              label={st.label}
              active={draft.status === st.value}
              testID={`vehicle-status-${st.value}`}
              onPress={() => { if (canEdit) set("status", st.value); }}
            />
          ))}
        </Row>
        <Field label="Not" testID="vehicle-notes" value={draft.notes} onChangeText={(v) => set("notes", v)} multiline editable={canEdit} />
      </Card>
      {canEdit ? (
        <PrimaryButton title={isNew ? "Kaydet" : "Güncelle"} onPress={save} loading={busy} color={colors.primary} testID="vehicle-save" />
      ) : null}
      {!isNew && canDelete ? (
        <PrimaryButton title="Sil" onPress={remove} loading={busy} color={colors.danger} testID="vehicle-delete" />
      ) : null}
    </Screen>
  );
}
