import React, { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { loadRememberedB2bEmail, loadRememberedEmail, saveRememberedB2bEmail, saveRememberedEmail } from "../auth/storage";
import { Field, PrimaryButton } from "../components/kit";
import { colors } from "../theme";
import type { B2BForgotResult } from "../types";

type Mode = "erp" | "b2b" | "b2b-forgot" | "b2b-reset";

export function LoginScreen() {
  const { login, loginB2b, enterB2bToken, forgotB2b, resetB2b, baseUrl } = useAuth();
  const [mode, setMode] = useState<Mode>("erp");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [server, setServerField] = useState(baseUrl);
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetInfo, setResetInfo] = useState<B2BForgotResult | null>(null);
  const [resetToken, setResetToken] = useState("");
  const [portalLink, setPortalLink] = useState("");

  useEffect(() => {
    loadRememberedEmail().then((v) => {
      if (v) setEmail((cur) => cur || v);
    });
  }, []);
  useEffect(() => setServerField(baseUrl), [baseUrl]);

  const switchMode = async (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword("");
    setPassword2("");
    setResetInfo(null);
    if (next === "erp") {
      const saved = await loadRememberedEmail();
      if (saved) setEmail(saved);
    } else if (next === "b2b" || next === "b2b-forgot") {
      const saved = await loadRememberedB2bEmail();
      if (saved) setEmail(saved);
    }
  };

  const submitErp = async () => {
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

  const submitB2bLink = async () => {
    setBusy(true);
    setError(null);
    try {
      await enterB2bToken(portalLink, server.trim() || undefined);
    } catch (err) {
      setError(apiErrorMessage(err, "Portal linki geçersiz."));
    } finally {
      setBusy(false);
    }
  };

  const submitB2b = async () => {
    setBusy(true);
    setError(null);
    try {
      await loginB2b(email.trim(), password, server.trim() || undefined);
      await saveRememberedB2bEmail(email.trim().toLowerCase());
    } catch (err) {
      setError(apiErrorMessage(err, "Giriş yapılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async () => {
    setBusy(true);
    setError(null);
    setResetInfo(null);
    try {
      const res = await forgotB2b(email.trim());
      setResetInfo(res);
      if (res.reset_token) setResetToken(res.reset_token);
    } catch (err) {
      setError(apiErrorMessage(err, "İstek gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (password !== password2) {
      setError("Şifreler eşleşmiyor.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetB2b(resetToken, password);
    } catch (err) {
      setError(apiErrorMessage(err, "Şifre güncellenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const b2bMode = mode !== "erp";

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled" testID="login-page">
        <View style={styles.card} testID={b2bMode ? "b2b-login-page" : undefined}>
          <Image source={require("../../assets/icon.png")} style={styles.mark} />
          {mode === "erp" ? (
            <>
              <Text style={styles.brand}>Tam<Text style={{ color: colors.primary }}>Kobi</Text></Text>
              <Text style={styles.hint}>ERP hesabınızla giriş yapın. Web ile aynı kullanıcı.</Text>
              {error ? <Text style={styles.error} testID="login-error">{error}</Text> : null}
              <Field label="E-posta" testID="login-email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
              <Field label="Şifre" testID="login-password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} />
              {showServer ? (
                <Field label="API adresi" testID="login-api" autoCapitalize="none" value={server} onChangeText={setServerField} placeholder="https://tamkobi.com" />
              ) : null}
              <PrimaryButton testID="login-submit" title={busy ? "Giriş yapılıyor…" : "Giriş Yap"} onPress={submitErp} loading={busy} disabled={!email || !password} />
              <View style={styles.footerRow}>
                <Text style={styles.footer}>Bayi misiniz? </Text>
                <Pressable onPress={() => switchMode("b2b")} testID="login-b2b-link">
                  <Text style={styles.b2bLink}>B2B Girişi</Text>
                </Pressable>
              </View>
            </>
          ) : mode === "b2b-forgot" ? (
            <>
              <Text style={styles.eyebrow}>Şifre Sıfırlama</Text>
              <Text style={styles.brand}>Bağlantı isteyin</Text>
              <Text style={styles.hint}>Kayıtlı e-posta veya VKN girin. Eşleşen hesap varsa sıfırlama bağlantısı gönderilir.</Text>
              {error ? <Text style={styles.error} testID="b2b-forgot-error">{error}</Text> : null}
              {resetInfo ? (
                <View style={styles.okBox} testID="b2b-forgot-result">
                  <Text style={styles.okText}>{resetInfo.message}</Text>
                  {resetInfo.mail_status === "sent" ? <Text style={styles.okText}>E-postanızı kontrol edin (1 saat geçerli).</Text> : null}
                  {resetInfo.detail && resetInfo.mail_status !== "sent" ? <Text style={styles.okText}>{resetInfo.detail}</Text> : null}
                  {resetInfo.reset_token ? (
                    <Pressable onPress={() => { setMode("b2b-reset"); setError(null); }} testID="b2b-forgot-link">
                      <Text style={[styles.okText, { fontWeight: "800", textDecorationLine: "underline" }]}>E-posta gönderilemedi — şifreyi buradan sıfırlayın</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <Field label="E-posta veya VKN" testID="b2b-forgot-email" autoCapitalize="none" autoComplete="email" value={email} onChangeText={setEmail} />
              {showServer ? (
                <Field label="API adresi" testID="login-api" autoCapitalize="none" value={server} onChangeText={setServerField} placeholder="https://tamkobi.com" />
              ) : null}
              <PrimaryButton testID="b2b-forgot-submit" title={busy ? "Gönderiliyor…" : "Sıfırlama Bağlantısı Gönder"} onPress={submitForgot} loading={busy} disabled={!email} color={colors.primary} />
              <Pressable onPress={() => switchMode("b2b")} testID="b2b-forgot-back" style={{ paddingTop: 12 }}>
                <Text style={styles.server}>Girişe dön</Text>
              </Pressable>
            </>
          ) : mode === "b2b-reset" ? (
            <>
              <Text style={styles.eyebrow}>B2B Şifre Sıfırlama</Text>
              <Text style={styles.brand}>Yeni şifre</Text>
              <Text style={styles.hint}>En az 6 karakter. Kaydettikten sonra portala giriş yapılır.</Text>
              {error ? <Text style={styles.error} testID="b2b-reset-error">{error}</Text> : null}
              <Field label="Yeni şifre" testID="b2b-reset-password" secureTextEntry value={password} onChangeText={setPassword} />
              <Field label="Yeni şifre (tekrar)" testID="b2b-reset-password2" secureTextEntry value={password2} onChangeText={setPassword2} />
              <PrimaryButton testID="b2b-reset-submit" title={busy ? "Kaydediliyor…" : "Şifreyi Kaydet"} onPress={submitReset} loading={busy} disabled={!password || password.length < 6} color={colors.primary} />
              <Pressable onPress={() => switchMode("b2b")} style={{ paddingTop: 12 }}>
                <Text style={styles.server}>Girişe dön</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.eyebrow}>B2B Müşteri Girişi</Text>
              <Text style={styles.brand}>Tam<Text style={{ color: colors.primary }}>Kobi</Text></Text>
              <Text style={styles.hint}>Tedarikçinizin size verdiği e-posta / VKN ve şifre ile.</Text>
              {error ? <Text style={styles.error} testID="b2b-login-error">{error}</Text> : null}
              <Field label="E-posta veya VKN" testID="b2b-login-email" autoCapitalize="none" autoComplete="email" value={email} onChangeText={setEmail} />
              <Field label="Şifre" testID="b2b-login-password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} />
              {showServer ? (
                <Field label="API adresi" testID="login-api" autoCapitalize="none" value={server} onChangeText={setServerField} placeholder="https://tamkobi.com" />
              ) : null}
              <PrimaryButton testID="b2b-login-submit" title={busy ? "Giriş yapılıyor…" : "Portala Giriş"} onPress={submitB2b} loading={busy} disabled={!email || !password} color={colors.primary} />
              <Field label="veya portal linki / token" testID="b2b-login-link" autoCapitalize="none" value={portalLink} onChangeText={setPortalLink} placeholder="https://…/portal/…" />
              <PrimaryButton testID="b2b-login-link-submit" title="Link ile gir" onPress={submitB2bLink} loading={busy} disabled={!portalLink.trim()} color={colors.indigo} />
              <Pressable onPress={() => switchMode("b2b-forgot")} testID="b2b-forgot-open" style={{ paddingTop: 12 }}>
                <Text style={styles.forgot}>Şifremi unuttum</Text>
              </Pressable>
              <View style={styles.footerRow}>
                <Text style={styles.footer}>ERP hesabınız mı var? </Text>
                <Pressable onPress={() => switchMode("erp")} testID="login-erp-link">
                  <Text style={styles.erpLink}>Personel girişi</Text>
                </Pressable>
              </View>
            </>
          )}
          <Pressable onPress={() => setShowServer((v) => !v)} style={{ paddingTop: 10 }} testID="login-toggle-server">
            <Text style={styles.server}>{showServer ? "Sunucu alanını gizle" : `Sunucu: ${baseUrl.replace(/^https?:\/\//, "")}`}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ink },
  wrap: { flexGrow: 1, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 400, backgroundColor: "#fff", borderRadius: 24, padding: 24 },
  mark: { width: 56, height: 56, borderRadius: 14, marginBottom: 12 },
  eyebrow: { fontSize: 11, fontWeight: "800", color: colors.primary, letterSpacing: 1.4, textTransform: "uppercase" },
  brand: { fontSize: 28, fontWeight: "900", color: colors.text },
  hint: { color: colors.muted, marginBottom: 16, marginTop: 4 },
  error: { color: colors.danger, fontWeight: "700", marginBottom: 8 },
  server: { textAlign: "center", color: colors.muted, fontSize: 12, fontWeight: "600" },
  footerRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", marginTop: 14 },
  footer: { textAlign: "center", color: colors.muted, fontSize: 12, fontWeight: "600" },
  b2bLink: { color: colors.indigo, fontWeight: "800" },
  erpLink: { color: colors.primary, fontWeight: "800" },
  forgot: { textAlign: "center", color: colors.primaryHover, fontSize: 13, fontWeight: "800" },
  okBox: { backgroundColor: colors.emerald50, borderRadius: 12, padding: 10, marginBottom: 12, gap: 4 },
  okText: { color: "#065F46", fontSize: 12, fontWeight: "600" },
});
