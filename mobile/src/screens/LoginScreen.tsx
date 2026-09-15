import React, { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { loadRememberedEmail, saveRememberedEmail } from "../auth/storage";
import { Field, PrimaryButton } from "../components/ui";
import { colors } from "../theme";

export function LoginScreen() {
  const { login, baseUrl } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServerField] = useState(baseUrl);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRememberedEmail().then(setEmail);
  }, []);
  useEffect(() => setServerField(baseUrl), [baseUrl]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password, server.trim() || undefined);
      await saveRememberedEmail(email.trim().toLowerCase());
    } catch (err) {
      setError(apiErrorMessage(err, "Giriş yapılamadı."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} testID="login-page">
      <View style={styles.card}>
        <Image source={require("../../assets/icon.png")} style={styles.mark} />
        <Text style={styles.brand}>Tam<Text style={{ color: colors.accent }}>Kobi</Text></Text>
        <Text style={styles.hint}>ERP hesabınızla giriş yapın. Web ile aynı kullanıcı.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Field label="E-posta" testID="login-email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
        <Field label="Şifre" testID="login-password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} />
        {showServer ? (
          <Field label="API adresi" testID="login-api" autoCapitalize="none" value={server} onChangeText={setServerField} placeholder="https://tamkobi.com" />
        ) : null}
        <PrimaryButton testID="login-submit" title={busy ? "Giriş yapılıyor…" : "Giriş Yap"} onPress={submit} loading={busy} disabled={!email || !password} />
        <Pressable onPress={() => setShowServer((v) => !v)} style={{ paddingTop: 10 }} testID="login-toggle-server">
          <Text style={styles.server}>{showServer ? "Sunucu alanını gizle" : `Sunucu: ${baseUrl.replace(/^https?:\/\//, "")}`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 400, backgroundColor: "#fff", borderRadius: 24, padding: 24 },
  mark: { width: 56, height: 56, borderRadius: 14, marginBottom: 12 },
  brand: { fontSize: 28, fontWeight: "900", color: colors.text },
  hint: { color: colors.muted, marginBottom: 16, marginTop: 4 },
  error: { color: colors.danger, fontWeight: "700", marginBottom: 8 },
  server: { textAlign: "center", color: colors.muted, fontSize: 12, fontWeight: "600" },
});
