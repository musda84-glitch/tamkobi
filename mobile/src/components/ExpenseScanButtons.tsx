import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Platform } from "react-native";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Muted, PrimaryButton } from "./kit";
import { colors } from "../theme";
import {
  EXPENSE_SCAN_IDLE_HINT,
  expenseScanHint,
  extractExpenseFromAsset,
  type ExpenseExtractResponse,
  type ExpenseScanDraft,
} from "../utils/expenseScan";
import { pickBrowserReceipt } from "../utils/formDataFile";

export function ExpenseScanButtons({
  onDraft,
  onHint,
  onError,
  disabled,
  testID = "exp-scan",
}: {
  onDraft: (draft: ExpenseScanDraft, match?: ExpenseExtractResponse["matched_contact"]) => void;
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
      const out = await extractExpenseFromAsset(client, companyId, asset);
      const draft = out.draft || null;
      if (!draft || !(Number(draft.amount) > 0)) {
        onError?.("Fişten tutar okunamadı. Daha net bir fotoğraf deneyin.");
        return;
      }
      onDraft(draft, out.matched_contact);
      onHint?.(expenseScanHint(draft));
    } catch (err) {
      onError?.(apiErrorMessage(err, "Fiş okunamadı."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Muted testID={`${testID}-hint`}>
        {busy ? "Fiş okunuyor…" : EXPENSE_SCAN_IDLE_HINT}
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
