import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useEffect, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius } from "../theme";
import { normalizeScanText } from "../utils/b2bCatalog";
import { WebBarcodeCamera } from "./WebBarcodeCamera";
import { PrimaryButton } from "./kit";

const NATIVE_TYPES = [
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "code93",
  "codabar",
  "itf14",
  "qr",
  "pdf417",
  "datamatrix",
  "aztec",
] as const;

export function BarcodeScannerModal({
  visible,
  onClose,
  onScan,
  continuous = false,
}: {
  visible: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  continuous?: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (visible && Platform.OS !== "web" && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  useEffect(() => {
    if (!visible) setLocked(false);
  }, [visible]);

  const emit = (code: string) => {
    const value = normalizeScanText(code);
    if (!value || locked) return;
    setLocked(true);
    onScan(value);
    setManual("");
    setTimeout(() => setLocked(false), continuous ? 900 : 800);
    if (!continuous) onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap} testID="barcode-scanner-modal">
        <Text style={styles.title}>{continuous ? "Seri barkod okut" : "Barkod okut"}</Text>
        {continuous ? <Text style={styles.hint}>Okuttukça açık kalır. Bitince Kapat.</Text> : null}
        {Platform.OS === "web" ? (
          visible ? <WebBarcodeCamera active={visible} continuous={continuous} onScan={emit} /> : null
        ) : permission?.granted ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: [...NATIVE_TYPES] }}
            onBarcodeScanned={({ data }) => emit(data)}
          />
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.hint}>Kamera izni yok. Elle barkod girebilir veya izin verebilirsiniz.</Text>
            <PrimaryButton title="Kamera izni ver" onPress={() => requestPermission()} />
          </View>
        )}
        <TextInput
          testID="barcode-manual"
          value={manual}
          onChangeText={setManual}
          placeholder="Barkod / SKU"
          style={styles.input}
          autoCapitalize="none"
          autoFocus={Platform.OS === "web"}
          onSubmitEditing={() => emit(manual)}
        />
        <PrimaryButton title="Ara" onPress={() => emit(manual)} testID="barcode-submit" />
        <Pressable onPress={onClose} style={styles.cancel} testID="barcode-close">
          <Text style={styles.cancelText}>Kapat</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.secondary, padding: 20, paddingTop: 64, gap: 12 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  camera: { flex: 1, borderRadius: radius.lg, overflow: "hidden", minHeight: 240 },
  fallback: { backgroundColor: "#1E293B", borderRadius: radius.lg, padding: 16, gap: 12, minHeight: 160, justifyContent: "center" },
  hint: { color: "#CBD5E1" },
  input: { backgroundColor: "#fff", borderRadius: radius.md, padding: 12, fontSize: 16 },
  cancel: { alignItems: "center", padding: 12 },
  cancelText: { color: "#94A3B8", fontWeight: "700" },
});
