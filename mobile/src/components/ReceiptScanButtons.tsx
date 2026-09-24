import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Platform } from "react-native";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Muted, PrimaryButton } from "./kit";
import { colors } from "../theme";
import { pickBrowserReceipt } from "../utils/formDataFile";
import { extractReceiptFromAsset, receiptScanHint, type ReceiptDraft } from "../utils/receiptScan";

export function ReceiptScanButtons({
  onDraft,
  onHint,
  onError,
  disabled,
  testID = "receipt-scan",
}: {
  onDraft: (draft: ReceiptDraft) => void;
  onHint?: (hint: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { client, companyId } = useAuth();
  const [busy, setBusy] = useState(false);

  const pick = async (fromCamera: boolean) => {
    if (busy || disabled) return;
    setBusy(true);
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
      const out = await extractReceiptFromAsset(client, companyId, asset);
      const draft = (out.draft || null) as ReceiptDraft | null;
      if (!draft || !(Number(draft.amount) > 0)) {
        onError?.("Makbuzdan tutar okunamadı. Daha net bir fotoğraf deneyin.");
        return;
      }
      onDraft(draft);
      onHint?.(receiptScanHint(draft));
    } catch (err) {
      onError?.(apiErrorMessage(err, "Makbuz okunamadı."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Muted testID={`${testID}-hint`}>
        {busy ? "Makbuz okunuyor…" : "Kamera veya galeri ile makbuz okuyun; tutar ve açıklama dolar."}
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
