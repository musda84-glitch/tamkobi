import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius } from "../theme";
import { PrimaryButton } from "./ui";

export function BarcodeScannerModal({
  visible,
  onClose,
  onScan,
}: {
  visible: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [locked, setLocked] = useState(false);

  const emit = (code: string) => {
    const value = code.trim();
    if (!value || locked) return;
    setLocked(true);
    onScan(value);
    setManual("");
    setTimeout(() => setLocked(false), 800);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Text style={styles.title}>Barkod okut</Text>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "code128", "qr", "upc_a", "upc_e"] }}
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
          onSubmitEditing={() => emit(manual)}
        />
        <PrimaryButton title="Ekle" onPress={() => emit(manual)} testID="barcode-submit" />
        <Pressable onPress={onClose} style={styles.cancel}><Text style={styles.cancelText}>Kapat</Text></Pressable>
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
