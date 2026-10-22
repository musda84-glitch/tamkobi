import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, Vibration, View } from "react-native";
import { colors, radius } from "../theme";
import { normalizeScanText } from "../utils/b2bCatalog";
import { scanQtyOnBlur, scanQtyOnFocus, scanQtyShown } from "../utils/scanQty";
import { SHUTTER_DEDUPE_MS, SHUTTER_SINGLE_MS, ScanShutter, type ShutterMode } from "./ScanShutter";
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

const IDLE_HINT = "Dokun: tek okut · Basılı tut: seri okut";
const SERIAL_HINT = "Seri okuma sürüyor · bırakınca durur";

type RecentRead = { code: string; label: string };

/** expo-haptics bu pakette yok; titreşim React Native Vibration ile verilir. */
function shutterFeedback() {
  try {
    Vibration?.vibrate?.(40);
  } catch {
    /* titreşim yok */
  }
}

export function BarcodeScannerModal({
  visible,
  onClose,
  onScan,
  continuous = false,
  qtyEnabled = false,
  qty,
  onQtyChange,
  status,
}: {
  visible: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  /** Geriye uyumluluk. Seri / tek ayrımı deklanşördedir; bu prop davranışı değiştirmez. */
  continuous?: boolean;
  qtyEnabled?: boolean;
  qty?: string;
  onQtyChange?: (value: string) => void;
  status?: string | null;
}) {
  void continuous;
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [torch, setTorch] = useState(false);
  const [mode, setMode] = useState<ShutterMode>("idle");
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState<RecentRead[]>([]);
  const [toast, setToast] = useState<RecentRead | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [flash, setFlash] = useState(false);

  const modeRef = useRef<ShutterMode>("idle");
  const visibleRef = useRef(visible);
  const onScanRef = useRef(onScan);
  const statusRef = useRef(status);
  const lastRef = useRef({ code: "", at: 0 });
  const statusAtScan = useRef("");
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  visibleRef.current = visible;
  onScanRef.current = onScan;
  statusRef.current = status;

  const clearSingle = () => {
    if (singleTimer.current) clearTimeout(singleTimer.current);
    singleTimer.current = null;
  };

  const setModeBoth = (next: ShutterMode) => {
    modeRef.current = next;
    setMode(next);
  };

  useEffect(() => {
    if (visible && Platform.OS !== "web" && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  useEffect(() => {
    if (visible) return;
    clearSingle();
    modeRef.current = "idle";
    setMode("idle");
    setNotFound(false);
    setToast(null);
    setRecent([]);
    setCount(0);
    setFlash(false);
    setTorch(false);
    lastRef.current = { code: "", at: 0 };
  }, [visible]);

  useEffect(() => () => {
    clearSingle();
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  useEffect(() => {
    if (!status || status === statusAtScan.current) return;
    setToast((current) => (current && current.label !== status ? { ...current, label: status } : current));
    setRecent((rows) => {
      if (!rows.length || rows[0].label === status) return rows;
      return [{ ...rows[0], label: status }, ...rows.slice(1)];
    });
  }, [status]);

  const showHit = (code: string, serial: boolean) => {
    statusAtScan.current = statusRef.current || "";
    setToast({ code, label: code });
    setNotFound(false);
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 180);
    shutterFeedback();
    if (serial) {
      setCount((n) => n + 1);
      setRecent((rows) => [{ code, label: code }, ...rows].slice(0, 6));
    }
  };

  const acceptCamera = (raw: string) => {
    if (!visibleRef.current) return;
    const value = normalizeScanText(raw);
    if (!value) return;
    const now = Date.now();
    const current = modeRef.current;
    if (current === "single") {
      clearSingle();
      setModeBoth("idle");
      lastRef.current = { code: value, at: now };
      showHit(value, false);
      onScanRef.current(value);
      return;
    }
    if (current !== "serial") return;
    if (lastRef.current.code === value && now - lastRef.current.at < SHUTTER_DEDUPE_MS) return;
    lastRef.current = { code: value, at: now };
    showHit(value, true);
    onScanRef.current(value);
  };

  const beginSingle = () => {
    if (!visibleRef.current) return;
    clearSingle();
    setNotFound(false);
    setModeBoth("single");
    singleTimer.current = setTimeout(() => {
      if (modeRef.current !== "single") return;
      setModeBoth("idle");
      setNotFound(true);
    }, SHUTTER_SINGLE_MS);
  };

  const beginSerial = () => {
    if (!visibleRef.current) return;
    clearSingle();
    setNotFound(false);
    setCount(0);
    setRecent([]);
    lastRef.current = { code: "", at: 0 };
    setModeBoth("serial");
  };

  const endSerial = () => {
    if (modeRef.current !== "serial") return;
    setModeBoth("idle");
  };

  const submitManual = () => {
    const value = normalizeScanText(manual);
    if (!value) return;
    setManual("");
    if (modeRef.current === "single") {
      clearSingle();
      setModeBoth("idle");
    }
    const serial = modeRef.current === "serial";
    if (serial) lastRef.current = { code: value, at: Date.now() };
    showHit(value, serial);
    onScanRef.current(value);
  };

  const cameraReady = Platform.OS === "web" || !!permission?.granted;
  const title = mode === "serial" ? "Seri okuma" : "Barkod okut";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap} testID="barcode-scanner-modal">
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Ionicons name="camera-outline" size={22} color={colors.primary} />
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              testID="barcode-torch"
              onPress={() => setTorch((on) => !on)}
              accessibilityLabel="Flaş"
              style={styles.iconBtn}
            >
              <Ionicons name={torch ? "flash" : "flash-outline"} size={22} color={torch ? "#FBBF24" : "#fff"} />
            </Pressable>
            <Pressable testID="barcode-close" onPress={onClose} accessibilityLabel="Kapat" style={styles.iconBtn}>
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
          </View>
        </View>

        <View style={styles.stage}>
          {Platform.OS === "web" ? (
            visible ? <WebBarcodeCamera active={visible} continuous={continuous} torch={torch} onScan={acceptCamera} /> : null
          ) : permission?.granted ? (
            <CameraView
              style={styles.camera}
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: [...NATIVE_TYPES] }}
              onBarcodeScanned={({ data }) => acceptCamera(data)}
            />
          ) : (
            <View style={styles.fallback}>
              <Text style={styles.permHint}>Kamera izni yok. Elle barkod girebilir veya izin verebilirsiniz.</Text>
              <PrimaryButton title="Kamera izni ver" onPress={() => requestPermission()} />
            </View>
          )}
          {cameraReady ? <View pointerEvents="none" style={styles.frame} /> : null}
          {flash ? <View pointerEvents="none" style={styles.flash} /> : null}
          {toast && !notFound ? (
            <View pointerEvents="none" style={styles.toast} testID="barcode-toast">
              <Text style={styles.toastCheck}>✓</Text>
              <Text style={styles.toastText} numberOfLines={1}>{toast.label}</Text>
            </View>
          ) : null}
          {notFound ? (
            <Text testID="barcode-notfound" style={styles.notFound}>bulunamadı</Text>
          ) : null}
          {mode === "serial" ? (
            <View pointerEvents="none" style={styles.badge} testID="barcode-serial-badge">
              <Text style={styles.badgeText}>● SERİ</Text>
            </View>
          ) : null}
          {mode === "serial" ? (
            <View pointerEvents="none" style={styles.countWrap} testID="barcode-count">
              <Text style={styles.count}>{count}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.hint} testID="barcode-hint">{mode === "serial" ? SERIAL_HINT : IDLE_HINT}</Text>
        {qtyEnabled ? (
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Adet çarpan</Text>
            <TextInput
              testID="barcode-qty"
              value={scanQtyShown(qty)}
              onChangeText={(v) => onQtyChange?.(v.replace(/[^\d]/g, ""))}
              onFocus={() => onQtyChange?.(scanQtyOnFocus())}
              onBlur={() => onQtyChange?.(scanQtyOnBlur(qty))}
              keyboardType="number-pad"
              style={styles.qtyInput}
            />
          </View>
        ) : null}
        {status ? <Text style={styles.status} testID="barcode-status">{status}</Text> : null}

        <ScanShutter mode={mode} onSingle={beginSingle} onSerialStart={beginSerial} onSerialEnd={endSerial} />

        {mode === "serial" && recent.length ? (
          <View style={styles.recent} testID="barcode-recent">
            {recent.map((row, index) => (
              <View key={`${row.code}-${index}`} style={styles.recentRow}>
                <View style={styles.recentCopy}>
                  <Text style={styles.recentName} numberOfLines={1}>{row.label}</Text>
                  {row.label !== row.code ? <Text style={styles.recentCode}>{row.code}</Text> : null}
                </View>
                <Text style={styles.recentCheck}>✓</Text>
              </View>
            ))}
          </View>
        ) : null}

        <TextInput
          testID="barcode-manual"
          value={manual}
          onChangeText={setManual}
          placeholder="Barkod / SKU"
          placeholderTextColor="#94A3B8"
          style={styles.input}
          autoCapitalize="none"
          autoFocus={Platform.OS === "web"}
          onSubmitEditing={submitManual}
        />
        <PrimaryButton title="Ara" onPress={submitManual} testID="barcode-submit" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.ink,
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 20,
    gap: 10,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  titleRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800", flexShrink: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stage: {
    flex: 1,
    minHeight: 240,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: "#000",
    position: "relative",
  },
  camera: { flex: 1, minHeight: 240 },
  fallback: { flex: 1, backgroundColor: "#1E293B", padding: 16, gap: 12, minHeight: 160, justifyContent: "center" },
  permHint: { color: "#CBD5E1" },
  frame: {
    position: "absolute",
    left: "8%",
    right: "8%",
    top: "22%",
    height: "46%",
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 16,
  },
  flash: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(5, 150, 105, 0.38)",
  },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(6, 78, 59, 0.92)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toastCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: "hidden",
    textAlign: "center",
    lineHeight: 22,
    backgroundColor: colors.primary,
    color: "#fff",
    fontWeight: "900",
  },
  toastText: { color: "#fff", fontWeight: "800", flex: 1 },
  notFound: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    textAlign: "center",
    color: "#fff",
    fontWeight: "800",
    backgroundColor: "rgba(136, 19, 55, 0.92)",
    borderRadius: 999,
    overflow: "hidden",
    paddingVertical: 8,
  },
  badge: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: colors.danger,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { color: "#fff", fontWeight: "900", fontSize: 12, letterSpacing: 0.4 },
  countWrap: {
    position: "absolute",
    top: 12,
    right: 12,
    minWidth: 32,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  count: { color: "#fff", fontWeight: "900", fontSize: 18, textAlign: "center" },
  hint: { color: "#CBD5E1", textAlign: "center", fontSize: 13 },
  status: { color: "#A7F3D0", fontWeight: "700", textAlign: "center" },
  qtyRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  qtyLabel: { color: "#E2E8F0", fontWeight: "800", fontSize: 12 },
  qtyInput: {
    backgroundColor: "#fff",
    borderRadius: radius.md,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 56,
    textAlign: "center",
    fontWeight: "800",
    fontSize: 16,
  },
  recent: { gap: 6 },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(15, 23, 42, 0.9)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recentCopy: { flex: 1, minWidth: 0 },
  recentName: { color: "#fff", fontWeight: "800" },
  recentCode: { color: "#94A3B8", fontSize: 12 },
  recentCheck: { color: colors.primary, fontWeight: "900", fontSize: 16 },
  input: { backgroundColor: "#fff", borderRadius: radius.md, padding: 12, fontSize: 16 },
});
