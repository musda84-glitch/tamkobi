import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { Field, PrimaryButton } from "../components/kit";
import { colors, radius, spacing } from "../theme";
import { normalizePairingCode, scrubPairingCode } from "../utils/shopfloorDevice";

export function ShopfloorPairScreen() {
  const { pairShopfloorDevice, baseUrl } = useAuth();
  const [code, setCode] = useState("");
  const [server, setServer] = useState(baseUrl);
  const [showServer, setShowServer] = useState(false);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (raw: string) => {
    const next = normalizePairingCode(raw);
    if (!next) {
      setError("Kod 6 karakter olmalı. QR adres taşımıyorsa kamerayla da okunur.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await pairShopfloorDevice(next, showServer ? server.trim() : undefined);
      setCode("");
    } catch (err) {
      setError(apiErrorMessage(err, "Eşleştirme yapılamadı."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.slate50, padding: spacing.lg, justifyContent: "center" }} testID="shopfloor-pair-page">
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: 12 }}>
        <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text }}>Atölye cihazı</Text>
        <Text style={{ color: colors.muted, fontSize: 15 }}>
          Yöneticinin verdiği kodu yazın veya QR okutun. Eşleşince bu telefon Atölye iş ekranında kalır. Kod adreste tutulmaz.
        </Text>
        {error ? <Text testID="shopfloor-pair-error" style={{ color: "#B91C1C", fontWeight: "700" }}>{error}</Text> : null}
        <Field
          label="Eşleştirme kodu"
          testID="shopfloor-pair-code"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          value={code}
          onChangeText={(value) => setCode(scrubPairingCode(value))}
          style={{ fontSize: 28, letterSpacing: 4, textAlign: "center", fontWeight: "800", minHeight: 64 }}
        />
        {showServer ? (
          <Field
            label="API adresi"
            testID="shopfloor-pair-api"
            autoCapitalize="none"
            value={server}
            onChangeText={setServer}
            placeholder="https://tamkobi.com"
          />
        ) : null}
        <PrimaryButton
          testID="shopfloor-pair-submit"
          title={busy ? "Eşleştiriliyor…" : "Eşleştir"}
          onPress={() => { void submit(code); }}
          loading={busy}
          disabled={busy || code.length < 6}
        />
        <Pressable
          testID="shopfloor-pair-scan"
          onPress={() => setScan(true)}
          style={{ minHeight: 52, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>QR okut</Text>
        </Pressable>
        <Pressable onPress={() => setShowServer((v) => !v)} testID="shopfloor-pair-server-toggle">
          <Text style={{ textAlign: "center", color: colors.muted, fontWeight: "700" }}>{showServer ? "Sunucu adresini gizle" : "Sunucu adresi"}</Text>
        </Pressable>
      </View>
      <BarcodeScannerModal
        visible={scan}
        onClose={() => setScan(false)}
        onScan={(value) => {
          const next = normalizePairingCode(value);
          setScan(false);
          if (!next) {
            setError("QR tanınmadı. Kodu elle yazın.");
            return;
          }
          setCode(next);
          void submit(next);
        }}
      />
    </View>
  );
}
