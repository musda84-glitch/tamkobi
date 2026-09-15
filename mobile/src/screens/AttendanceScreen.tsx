import * as Location from "expo-location";
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Badge, Card, ErrorBanner, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/ui";
import { colors } from "../theme";

type AttendancePayload = {
  employee?: { full_name: string } | null;
  now?: string;
  today_date?: string;
  today?: { check_in?: string; check_out?: string; hours?: number; late_minutes?: number } | null;
  location?: { label?: string; radius_m?: number } | null;
  schedule?: { require_geo?: boolean; start?: string; end?: string };
  records?: { id?: string; date: string; check_in?: string; check_out?: string; hours?: number; status?: string }[];
  summary?: { days?: number; hours?: number };
};

async function coords() {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") throw new Error("Konum izni verilmedi.");
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy_m: pos.coords.accuracy };
}

export function AttendanceScreen() {
  const { client, companyId } = useAuth();
  const [data, setData] = useState<AttendancePayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const month = new Date().toISOString().slice(0, 7);
      const res = await get<AttendancePayload>(client, "/personnel/attendance/me", { company_id: companyId, month });
      setData(res);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Puantaj yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  const act = async (action: "check_in" | "check_out") => {
    setBusy(action);
    setError(null);
    try {
      let extra: { latitude?: number; longitude?: number; accuracy_m?: number } = {};
      if (action === "check_in" && data?.location && data?.schedule?.require_geo !== false) {
        const c = await coords();
        extra = { latitude: c.latitude, longitude: c.longitude, accuracy_m: c.accuracy_m ?? undefined };
      }
      const r = await post<{ message?: string }>(client, "/personnel/attendance/self", { action, ...extra });
      setMessage(r.message || "Kaydedildi.");
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusy(null);
    }
  };

  const today = data?.today;
  const checkedIn = Boolean(today?.check_in);
  const checkedOut = Boolean(today?.check_out);

  return (
    <Screen onRefresh={load}>
      <H1>Mesaim</H1>
      <Muted>{data?.employee?.full_name || "Personel kartı bağlı değilse giriş yapılamaz."}</Muted>
      <ErrorBanner message={error} />
      {message ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{message}</Text></Card> : null}
      <Card>
        <Text style={{ fontSize: 42, fontWeight: "900", color: colors.text, textAlign: "center" }}>{data?.now || "--:--"}</Text>
        <Muted>{data?.today_date}</Muted>
        <Row style={{ justifyContent: "center", gap: 8 }}>
          {checkedIn ? <Badge label={`Giriş ${today?.check_in}`} tone="green" /> : <Badge label="Giriş yok" />}
          {checkedOut ? <Badge label={`Çıkış ${today?.check_out}`} tone="indigo" /> : null}
          {today?.late_minutes ? <Badge label={`${today.late_minutes} dk geç`} tone="red" /> : null}
        </Row>
        <View style={{ gap: 10, marginTop: 8 }}>
          <PrimaryButton title={busy === "check_in" ? "Kaydediliyor…" : "Giriş"} onPress={() => act("check_in")} disabled={checkedIn} color={colors.accent} testID="mesai-in" />
          <PrimaryButton title={busy === "check_out" ? "Kaydediliyor…" : "Çıkış"} onPress={() => act("check_out")} disabled={!checkedIn || checkedOut} testID="mesai-out" />
        </View>
      </Card>
      {(data?.records || []).slice(0, 14).map((r) => (
        <ListRow key={r.id || r.date} title={r.date} subtitle={`${r.check_in || "--:--"} → ${r.check_out || "--:--"}`} right={r.hours ? `${r.hours} sa` : r.status} />
      ))}
    </Screen>
  );
}
