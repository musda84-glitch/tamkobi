import React, { useEffect, useState } from "react";
import { Platform, Pressable, Text } from "react-native";
import { post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Screen } from "../components/kit";
import { colors } from "../theme";
import { passwordChangePayload, validatePasswordChange } from "../utils/account";
import { getPriceDecimals, idOf } from "../utils/money";
import { getStoredPushToken, presentLocalNotification, registerDevicePush, type PushStatus } from "../utils/pushRegister";

export function SettingsScreen() {
  const { client, companies, activeCompany, switchCompany, user, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus>("idle");
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    getStoredPushToken().then((t) => setPushStatus(t ? "ok" : Platform.OS === "web" ? "web" : "idle"));
  }, []);

  const savePassword = async () => {
    const invalid = validatePasswordChange(current, next, confirm);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ message?: string }>(client, "/auth/change-password", passwordChangePayload(current, next));
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage(r?.message || "Şifreniz güncellendi.");
    } catch (err) {
      setError(apiErrorMessage(err, "Şifre değiştirilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>Ayarlar</H1>
      <Muted>{user?.email} · {user?.role_name || user?.role}</Muted>
      <ErrorBanner message={error} />
      {message ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{message}</Text></Card> : null}

      <Card testID="settings-change-password">
        <Text style={{ fontWeight: "800", color: colors.text }}>Şifre yenile</Text>
        <Muted>Mevcut şifre doğrulanır. Yeni şifre en az 6 karakter olmalı.</Muted>
        <Field label="Mevcut şifre" testID="settings-pw-current" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
        <Field label="Yeni şifre" testID="settings-pw-new" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label="Yeni şifre (tekrar)" testID="settings-pw-confirm" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <PrimaryButton title="Şifreyi değiştir" testID="settings-pw-save" onPress={savePassword} loading={busy} color={colors.primary} />
      </Card>

      <Card testID="settings-push">
        <Text style={{ fontWeight: "800", color: colors.text }}>Telefon bildirimleri</Text>
        <Muted>
          {pushStatus === "ok"
            ? "Bu cihazda açık. Uygulama içi bildirimler bildirim çubuğuna da düşer."
            : pushStatus === "web"
              ? "Tarayıcıda telefon bildirimi yok; Android / iOS uygulamasında açılır."
              : pushStatus === "denied"
                ? "Bildirim izni kapalı. Telefondan izin verip yeniden deneyin."
                : "İzin açıksa bekleyen ve yeni bildirimler telefona da yazılır. Uygulamayı bir kez açın."}
        </Muted>
        {Platform.OS !== "web" ? (
          <>
            <PrimaryButton
              title={pushBusy ? "Açılıyor…" : "Bildirimleri aç"}
              testID="settings-push-enable"
              onPress={async () => {
                setPushBusy(true);
                try {
                  const r = await registerDevicePush(client);
                  setPushStatus(r.status === "ok" ? "ok" : r.status);
                  const local = await presentLocalNotification({
                    title: "TamKobi",
                    body: "Telefon bildirimleri açık. Uygulama içi kayıtlar buraya da düşer.",
                    data: { link: "/notifications" },
                  });
                  if (r.status === "denied") setError("Bildirim izni verilmedi.");
                  else if (local) setMessage("Telefon bildirimi gönderildi. Bildirim çubuğunu kontrol edin.");
                  else setError(r.error || "Telefon bildirimi gösterilemedi.");
                } finally {
                  setPushBusy(false);
                }
              }}
              loading={pushBusy}
              color={colors.indigo}
            />
          </>
        ) : null}
      </Card>

      <Card testID="settings-price-decimals">
        <Text style={{ fontWeight: "800", color: colors.text }}>Fiyat hassasiyeti</Text>
        <Muted>
          {getPriceDecimals()} hane. Web paneldeki şirket ayarıdır; ürün fiyatı, sipariş, fatura ve B2B tutarları bu hassasiyetle gösterilir.
        </Muted>
      </Card>

      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Aktif şirket</Text>
        {companies.map((c) => {
          const id = idOf(c);
          const active = id === idOf(activeCompany);
          return (
            <Pressable key={id} onPress={() => switchCompany(id)} style={{ paddingVertical: 10 }}>
              <Text style={{ fontWeight: active ? "800" : "600", color: active ? colors.primary : colors.text }}>{c.name}{active ? "  ✓" : ""}</Text>
            </Pressable>
          );
        })}
      </Card>
      <PrimaryButton title="Çıkış yap" onPress={() => logout()} color={colors.danger} />
    </Screen>
  );
}
