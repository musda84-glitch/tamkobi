import React, { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { loadRememberedB2bEmail, loadRememberedEmail, saveRememberedB2bEmail, saveRememberedEmail } from "../auth/storage";
import { Field, PrimaryButton } from "../components/kit";
import { colors, typeface } from "../theme";
import type { B2BForgotResult } from "../types";
import { contentBottomPad, loginSheetJustify } from "../utils/keyboardPad";
import { emailToRemember } from "../utils/loginRemember";
import { useKeyboardAwareScroll } from "../utils/useKeyboardAwareScroll";

type Mode = "erp" | "erp-forgot" | "erp-reset" | "b2b" | "b2b-forgot" | "b2b-reset";

function RememberRow({
  remember,
  onToggle,
  onForget,
  testPrefix,
}: {
  remember: boolean;
  onToggle: () => void;
  onForget: () => void;
  testPrefix: string;
}) {
  return (
    <View style={styles.rememberRow} testID={`${testPrefix}-remember-row`}>
      <Pressable onPress={onToggle} style={styles.rememberLabel} testID={`${testPrefix}-remember`}>
        <View style={[styles.check, remember && styles.checkOn]}>
          {remember ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
        <Text style={styles.rememberText}>Beni hatırla</Text>
      </Pressable>
      <Pressable onPress={onForget} testID={`${testPrefix}-forget`}>
        <Text style={styles.forget}>Beni unut</Text>
      </Pressable>
    </View>
  );
}

export function LoginScreen() {
  const { login, loginB2b, enterB2bToken, forgotB2b, resetB2b, forgotErp, resetErp, baseUrl } = useAuth();
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
  const [rememberErp, setRememberErp] = useState(true);
  const [rememberB2b, setRememberB2b] = useState(true);
  const { keyboardHeight, scrollRef, scrollProps } = useKeyboardAwareScroll();
  const sheetPad = contentBottomPad(24, keyboardHeight, Platform.OS);

  useEffect(() => {
    loadRememberedEmail().then((v) => {
      if (v) {
        setEmail((cur) => cur || v);
        setRememberErp(true);
      }
    });
  }, []);
  useEffect(() => setServerField(baseUrl), [baseUrl]);

  const switchMode = async (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword("");
    setPassword2("");
    setResetInfo(null);
    if (next === "erp" || next === "erp-forgot") {
      const saved = await loadRememberedEmail();
      if (saved) setEmail(saved);
    } else if (next === "b2b" || next === "b2b-forgot") {
      const saved = await loadRememberedB2bEmail();
      if (saved) setEmail(saved);
    }
  };

  const forgetErp = async () => {
    await saveRememberedEmail(null);
    setEmail("");
    setPassword("");
    setRememberErp(false);
  };

  const forgetB2b = async () => {
    await saveRememberedB2bEmail(null);
    setEmail("");
    setPassword("");
    setRememberB2b(false);
  };

  const submitErp = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password, server.trim() || undefined, rememberErp);
      await saveRememberedEmail(emailToRemember(rememberErp, email));
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
      await saveRememberedB2bEmail(emailToRemember(rememberB2b, email));
    } catch (err) {
      setError(apiErrorMessage(err, "Giriş yapılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (kind: "erp" | "b2b") => {
    setBusy(true);
    setError(null);
    setResetInfo(null);
    try {
      const res = kind === "erp" ? await forgotErp(email.trim(), "login") : await forgotB2b(email.trim());
      setResetInfo(res);
      if (res.reset_token) setResetToken(res.reset_token);
    } catch (err) {
      setError(apiErrorMessage(err, "İstek gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (kind: "erp" | "b2b") => {
    if (password !== password2) {
      setError("Şifreler eşleşmiyor.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (kind === "erp") {
        await resetErp(resetToken, password);
        setPassword("");
        setPassword2("");
        await switchMode("erp");
      } else {
        await resetB2b(resetToken, password);
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Şifre güncellenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const b2bMode = mode === "b2b" || mode === "b2b-forgot" || mode === "b2b-reset";

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        ref={scrollRef}
        {...scrollProps}
        contentContainerStyle={[
          styles.wrap,
          { paddingBottom: sheetPad, justifyContent: loginSheetJustify(keyboardHeight) },
        ]}
        testID="login-page"
      >
        <View style={styles.card} testID={b2bMode ? "b2b-login-page" : undefined}>
          <Image source={require("../../assets/icon.png")} style={styles.mark} />
          {mode === "erp" ? (
            <>
              <Text style={styles.brand}>Tam<Text style={{ color: colors.primary }}>Kobi</Text></Text>
              <Text style={styles.hint}>ERP veya personel hesabınızla giriş yapın. Web ile aynı kullanıcı.</Text>
              {error ? <Text style={styles.error} testID="login-error">{error}</Text> : null}
              <Field label="E-posta" testID="login-email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
              <Field label="Şifre" testID="login-password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} />
              {showServer ? (
                <Field label="API adresi" testID="login-api" autoCapitalize="none" value={server} onChangeText={setServerField} placeholder="https://tamkobi.com" />
              ) : null}
              <RememberRow remember={rememberErp} onToggle={() => setRememberErp((v) => !v)} onForget={forgetErp} testPrefix="login" />
              <PrimaryButton testID="login-submit" title={busy ? "Giriş yapılıyor…" : "Giriş Yap"} onPress={submitErp} loading={busy} disabled={!email || !password} />
              <Pressable onPress={() => switchMode("erp-forgot")} testID="login-forgot-password-link" style={{ paddingTop: 12 }}>
                <Text style={styles.forgot}>Şifremi unuttum</Text>
              </Pressable>
              <View style={styles.footerRow}>
                <Text style={styles.footer}>Bayi misiniz? </Text>
                <Pressable onPress={() => switchMode("b2b")} testID="login-b2b-link">
                  <Text style={styles.b2bLink}>B2B Girişi</Text>
                </Pressable>
              </View>
            </>
          ) : mode === "erp-forgot" ? (
            <>
              <Text style={styles.eyebrow}>Şifre Sıfırlama</Text>
              <Text style={styles.brand}>Bağlantı isteyin</Text>
              <Text style={styles.hint}>ERP veya personel e-postanızı girin. Eşleşen hesap varsa sıfırlama bağlantısı gönderilir.</Text>
              {error ? <Text style={styles.error} testID="login-forgot-error">{error}</Text> : null}
              {resetInfo ? (
                <View style={styles.okBox} testID="login-forgot-result">
                  <Text style={styles.okText}>{resetInfo.message}</Text>
                  {resetInfo.mail_status === "sent" ? <Text style={styles.okText}>E-postanızı kontrol edin (1 saat geçerli).</Text> : null}
                  {resetInfo.detail && resetInfo.mail_status !== "sent" ? <Text style={styles.okText}>{resetInfo.detail}</Text> : null}
                  {resetInfo.reset_token ? (
                    <Pressable onPress={() => { setMode("erp-reset"); setError(null); }} testID="login-forgot-link">
                      <Text style={[styles.okText, { fontWeight: "800", textDecorationLine: "underline" }]}>E-posta gönderilemedi — şifreyi buradan sıfırlayın</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <Field label="E-posta" testID="login-forgot-email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
              {showServer ? (
                <Field label="API adresi" testID="login-api" autoCapitalize="none" value={server} onChangeText={setServerField} placeholder="https://tamkobi.com" />
              ) : null}
              <PrimaryButton testID="login-forgot-submit" title={busy ? "Gönderiliyor…" : "Sıfırlama Bağlantısı Gönder"} onPress={() => submitForgot("erp")} loading={busy} disabled={!email} />
              <Pressable onPress={() => switchMode("erp")} testID="login-forgot-back" style={{ paddingTop: 12 }}>
                <Text style={styles.server}>Girişe dön</Text>
              </Pressable>
            </>
          ) : mode === "erp-reset" ? (
            <>
              <Text style={styles.eyebrow}>Şifre Sıfırlama</Text>
              <Text style={styles.brand}>Yeni şifre</Text>
              <Text style={styles.hint}>En az 6 karakter. Kaydettikten sonra giriş yapın.</Text>
              {error ? <Text style={styles.error} testID="erp-reset-error">{error}</Text> : null}
              <Field label="Yeni şifre" testID="erp-reset-password" secureTextEntry value={password} onChangeText={setPassword} />
              <Field label="Yeni şifre (tekrar)" testID="erp-reset-password2" secureTextEntry value={password2} onChangeText={setPassword2} />
              <PrimaryButton testID="erp-reset-submit" title={busy ? "Kaydediliyor…" : "Şifreyi Kaydet"} onPress={() => submitReset("erp")} loading={busy} disabled={!password || password.length < 6} />
              <Pressable onPress={() => switchMode("erp")} style={{ paddingTop: 12 }}>
                <Text style={styles.server}>Girişe dön</Text>
              </Pressable>
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
              <PrimaryButton testID="b2b-forgot-submit" title={busy ? "Gönderiliyor…" : "Sıfırlama Bağlantısı Gönder"} onPress={() => submitForgot("b2b")} loading={busy} disabled={!email} color={colors.primary} />
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
              <PrimaryButton testID="b2b-reset-submit" title={busy ? "Kaydediliyor…" : "Şifreyi Kaydet"} onPress={() => submitReset("b2b")} loading={busy} disabled={!password || password.length < 6} color={colors.primary} />
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
              <RememberRow remember={rememberB2b} onToggle={() => setRememberB2b((v) => !v)} onForget={forgetB2b} testPrefix="b2b" />
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
  eyebrow: { fontSize: 11, color: colors.primary, letterSpacing: 1.4, textTransform: "uppercase", ...typeface("800") },
  brand: { fontSize: 28, color: colors.text, ...typeface("900") },
  hint: { color: colors.muted, marginBottom: 16, marginTop: 4, ...typeface("400") },
  error: { color: colors.danger, marginBottom: 8, ...typeface("700") },
  server: { textAlign: "center", color: colors.muted, fontSize: 12, ...typeface("600") },
  footerRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", marginTop: 14 },
  footer: { textAlign: "center", color: colors.muted, fontSize: 12, ...typeface("600") },
  b2bLink: { color: colors.indigo, ...typeface("800") },
  erpLink: { color: colors.primary, ...typeface("800") },
  forgot: { textAlign: "center", color: colors.primaryHover, fontSize: 13, ...typeface("800") },
  okBox: { backgroundColor: colors.emerald50, borderRadius: 12, padding: 10, marginBottom: 12, gap: 4 },
  okText: { color: "#065F46", fontSize: 12, ...typeface("600") },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.slate50,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    marginTop: 4,
  },
  rememberLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
  rememberText: { fontSize: 12, color: colors.slate800, ...typeface("600") },
  forget: { fontSize: 12, color: colors.muted, textDecorationLine: "underline", ...typeface("700") },
  check: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: "#fff", fontSize: 12, lineHeight: 14, ...typeface("800") },
});
