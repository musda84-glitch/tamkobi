import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Muted, PrimaryButton } from "./kit";
import { colors } from "../theme";
import {
  CHEQUE_SCAN_IDLE_HINT,
  chequeScanHint,
  extractChequeFromAsset,
  type ChequeExtractResponse,
  type ChequeScanDraft,
} from "../utils/chequeScan";
import { pickBrowserReceipt } from "../utils/formDataFile";

function SheetOption({
  testID,
  label,
  icon,
  color,
  onPress,
  disabled,
}: {
  testID: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 48,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text style={{ flex: 1, fontWeight: "800", color: colors.text }}>{label}</Text>
    </Pressable>
  );
}

export function ChequeScanButtons({
  onDraft,
  onHint,
  onError,
  disabled,
  testID = "cheque-scan",
  variant = "buttons",
}: {
  onDraft: (draft: ChequeScanDraft, match?: ChequeExtractResponse["matched_contact"]) => void;
  onHint?: (hint: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  testID?: string;
  /** buttons: liste kartı. sheet: formdaki kırmızı “Kamerayla çek oku”. batch: tahsilat listesindeki “Kamerayla ekle”. */
  variant?: "buttons" | "sheet" | "batch";
}) {
  const { client, companyId } = useAuth();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [busySource, setBusySource] = useState<"camera" | "gallery" | null>(null);

  const pick = async (fromCamera: boolean) => {
    if (busy || disabled) return;
    setBusy(true);
    setBusySource(fromCamera ? "camera" : "gallery");
    try {
      let asset = null as Awaited<ReturnType<typeof pickBrowserReceipt>>;
      if (Platform.OS === "web") {
        asset = await pickBrowserReceipt(fromCamera ? "camera" : "gallery");
      } else {
        const perm = fromCamera
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== "granted") {
          onError?.(fromCamera ? "Kamera izni verilmedi." : "Galeri izni verilmedi.");
          return;
        }
        const res = fromCamera
          ? await ImagePicker.launchCameraAsync({ quality: 0.8, exif: false })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, exif: false, mediaTypes: ["images"] });
        if (res.canceled || !res.assets?.length) return;
        asset = res.assets[0];
      }
      if (!asset) return;
      const out = await extractChequeFromAsset(client, companyId, asset);
      const draft = out.draft || null;
      if (!draft || !(Number(draft.amount) > 0)) {
        onError?.("Çekten tutar okunamadı. Daha net bir fotoğraf deneyin.");
        return;
      }
      onDraft(draft, out.matched_contact);
      onHint?.(chequeScanHint(draft));
    } catch (err) {
      onError?.(apiErrorMessage(err, "Çek okunamadı."));
    } finally {
      setBusy(false);
      setBusySource(null);
      setOpen(false);
    }
  };

  if (variant === "sheet" || variant === "batch") {
    const scanning = (source: "camera" | "gallery") => busy && busySource === source;
    const batch = variant === "batch";
    return (
      <>
        <Pressable
          testID={batch ? testID : `${testID}-open`}
          accessibilityRole="button"
          accessibilityLabel={batch ? "Kamerayla ekle" : "Kamerayla çek oku"}
          disabled={disabled || busy}
          onPress={() => setOpen(true)}
          style={{
            minHeight: batch ? 48 : 52,
            borderRadius: batch ? 12 : 14,
            backgroundColor: colors.danger,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 16,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: batch ? 15 : 16 }}>
            {busy ? "Okunuyor…" : batch ? "📷 Kamerayla ekle" : "📷 Kamerayla çek oku"}
          </Text>
        </Pressable>
        <Modal visible={open} animationType="slide" transparent onRequestClose={() => { if (!busy) setOpen(false); }}>
          <View style={{ flex: 1, justifyContent: "flex-end" }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kapat"
              testID={`${testID}-backdrop`}
              onPress={() => { if (!busy) setOpen(false); }}
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(15,23,42,0.45)" }}
            />
            <View
              testID={`${testID}-sheet`}
              style={{
                backgroundColor: colors.surface,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 16,
                gap: 8,
              }}
            >
              <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text }}>Çek oku</Text>
              {busy ? <Text style={{ color: colors.danger, fontWeight: "800" }}>Okunuyor…</Text> : null}
              <SheetOption
                testID={`${testID}-camera`}
                label={scanning("camera") ? "Okunuyor…" : "Kamera ile oku"}
                icon="camera-outline"
                color={colors.danger}
                disabled={disabled || busy}
                onPress={() => pick(true)}
              />
              <SheetOption
                testID={`${testID}-gallery`}
                label={scanning("gallery") ? "Okunuyor…" : "Galeriden oku"}
                icon="images-outline"
                color={colors.primary}
                disabled={disabled || busy}
                onPress={() => pick(false)}
              />
              <SheetOption
                testID={`${testID}-cancel`}
                label="Vazgeç"
                icon="close"
                color={colors.muted}
                onPress={() => { if (!busy) setOpen(false); }}
              />
            </View>
          </View>
        </Modal>
      </>
    );
  }

  return (
    <>
      <Muted testID={`${testID}-hint`}>
        {busy ? "Çek okunuyor…" : CHEQUE_SCAN_IDLE_HINT}
      </Muted>
      <PrimaryButton
        title={busy ? "Okunuyor…" : "Kamera ile oku"}
        onPress={() => pick(true)}
        loading={busy}
        disabled={disabled}
        color={colors.indigo}
        testID={`${testID}-camera`}
      />
      <PrimaryButton
        title={busy ? "Okunuyor…" : "Galeriden oku"}
        onPress={() => pick(false)}
        disabled={busy || disabled}
        color={colors.primary}
        testID={`${testID}-gallery`}
      />
    </>
  );
}
