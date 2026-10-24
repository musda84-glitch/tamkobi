import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { post } from "../api/client";
import { apiErrorMessage } from "../api/errors";
import { useAuth } from "../auth/AuthContext";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { ErrorBanner, PrimaryButton, Screen } from "../components/kit";
import { colors } from "../theme";
import { QR_LOGIN_APPROVE, QR_LOGIN_PREVIEW, QR_LOGIN_REJECT, qrLoginCode, type QrLoginPreview } from "../utils/qrLogin";

export function QrLoginConfirm({
  preview,
  busy,
  onApprove,
  onReject,
}: {
  preview: QrLoginPreview;
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const row = (label: string, value: string, testID: string) => (
    <View style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.slate100 }}>
      <Text style={{ fontSize: 11, color: colors.muted, fontWeight: "700" }}>{label}</Text>
      <Text testID={testID} style={{ fontSize: 15, color: colors.text, fontWeight: "700", marginTop: 2 }}>
        {value || "—"}
      </Text>
    </View>
  );
  const userLine = [preview.user_name, preview.user_email].filter(Boolean).join(" · ");
  return (
    <View testID="qr-login-confirm" style={{ gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text }}>Bu cihazda girişi onayla</Text>
      <Text style={{ color: colors.muted, fontSize: 13 }}>
        Onaylayınca bu tarayıcıda web oturumu açılır. Aktif şirketiniz değişmez.
      </Text>
      <View style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 }}>
        {row("Şirket", preview.company_name || "", "qr-login-company")}
        {row("Kullanıcı", userLine, "qr-login-user")}
        {row("Tarayıcı", preview.browser || "", "qr-login-browser")}
        {row("IP", preview.ip || "", "qr-login-ip")}
      </View>
      <PrimaryButton title="Girişi onayla" onPress={onApprove} loading={busy} disabled={busy} testID="qr-login-approve" />
      <Pressable onPress={onReject} disabled={busy} testID="qr-login-reject" accessibilityLabel="Reddet" style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.danger, fontWeight: "800" }}>Reddet</Text>
      </Pressable>
    </View>
  );
}

export function QrWebLoginScreen() {
  const { client } = useAuth();
  const [scan, setScan] = useState(false);
  const [preview, setPreview] = useState<QrLoginPreview | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);

  const onScan = async (raw: string) => {
    const parsed = qrLoginCode(raw);
    if (!parsed) {
      setError("Bu kod web girişi değil.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const data = await post<QrLoginPreview>(client, QR_LOGIN_PREVIEW, { code: parsed });
      setCode(parsed);
      setPreview(data);
      setScan(false);
      setDone(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Kod okunamadı."));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (path: string, next: "approved" | "rejected") => {
    if (!code || busy) return;
    setBusy(true);
    setError("");
    try {
      await post(client, path, { code });
      setDone(next);
      setPreview(null);
      setCode("");
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem tamamlanamadı."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 13, color: colors.muted }}>
          app.tamkobi.com giriş sayfasındaki QR kodu okutun.
        </Text>
        <ErrorBanner message={error} />
        {done === "approved" ? (
          <Text testID="qr-login-done" style={{ color: colors.primary, fontWeight: "800" }}>
            Web girişi onaylandı. Bilgisayardaki sayfa birazdan açılır.
          </Text>
        ) : null}
        {done === "rejected" ? (
          <Text testID="qr-login-done" style={{ color: colors.danger, fontWeight: "800" }}>
            Giriş reddedildi.
          </Text>
        ) : null}
        {preview ? (
          <QrLoginConfirm
            preview={preview}
            busy={busy}
            onApprove={() => { void decide(QR_LOGIN_APPROVE, "approved"); }}
            onReject={() => { void decide(QR_LOGIN_REJECT, "rejected"); }}
          />
        ) : (
          <PrimaryButton title={busy ? "Okunuyor…" : "QR okut"} onPress={() => { setError(""); setScan(true); }} disabled={busy} testID="qr-login-scan" />
        )}
      </View>
      <BarcodeScannerModal visible={scan} onClose={() => setScan(false)} onScan={(value) => { void onScan(value); }} status={error || null} />
    </Screen>
  );
}
