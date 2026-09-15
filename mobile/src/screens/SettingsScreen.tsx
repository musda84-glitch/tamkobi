import React, { useState } from "react";
import { Pressable, Text } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Screen } from "../components/ui";
import { colors } from "../theme";
import { idOf } from "../utils/money";

export function SettingsScreen() {
  const { baseUrl, setServer, companies, activeCompany, switchCompany, user, logout } = useAuth();
  const [url, setUrl] = useState(baseUrl);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setServer(url);
      setProbe("Adres kaydedildi. Yeniden giriş yapın.");
    } catch (err) {
      setError(apiErrorMessage(err, "Adres kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const ping = async () => {
    setBusy(true);
    try {
      const data = await get<{ app?: string; min_app_version?: string; version?: { git_sha_short?: string } }>(
        { baseUrl: url, token: null },
        "/mobile/manifest"
      );
      setProbe(`${data.app || "TamKobi"} · min ${data.min_app_version} · API ${data.version?.git_sha_short || "?"}`);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "API yanıt vermedi."));
      setProbe(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>Ayarlar</H1>
      <Muted>{user?.email} · {user?.role_name || user?.role}</Muted>
      <Field label="API adresi" autoCapitalize="none" value={url} onChangeText={setUrl} />
      <ErrorBanner message={error} />
      {probe ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{probe}</Text></Card> : null}
      <PrimaryButton title="Bağlantıyı dene" onPress={ping} loading={busy} color={colors.primary} />
      <PrimaryButton title="Kaydet" onPress={save} loading={busy} />
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
