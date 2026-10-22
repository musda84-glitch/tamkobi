import React, { useState } from "react";
import { Image, Modal, Pressable, Text, View } from "react-native";
import { colors, radius, spacing } from "../theme";
import { formatQty } from "../utils/shopFloor";
import {
  formatShopfloorClock,
  partialForecast,
  takeoverTitle,
  type TakeoverDetail,
} from "../utils/shopFloorScreen";
import { ShopfloorPinPad } from "./ShopfloorPinPad";

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];

export function ShopFloorNumpad({
  value,
  onChange,
  onAccept,
  testID = "shopfloor-numpad",
}: {
  value: string;
  onChange: (next: string) => void;
  onAccept?: () => void;
  testID?: string;
}) {
  const push = (key: string) => {
    if (key === "⌫") {
      onChange(String(value || "").slice(0, -1));
      return;
    }
    if (key === "✓") {
      onAccept?.();
      return;
    }
    const next = `${value || ""}${key}`.replace(/^0+(?=\d)/, "");
    if (next.length > 6) return;
    onChange(next);
  };
  return (
    <View testID={testID} style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {PAD.map((key) => (
        <Pressable
          key={key}
          testID={`${testID}-${key === "⌫" ? "back" : key === "✓" ? "ok" : key}`}
          onPress={() => push(key)}
          style={{
            width: "30%",
            flexGrow: 1,
            height: 60,
            borderRadius: 14,
            borderWidth: 2,
            borderColor: "#E2E8F0",
            backgroundColor: "#F1F5F9",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>{key}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function PartialCountDialog({
  job,
  unit = "Adet",
  busy,
  onClose,
  onSubmit,
}: {
  job: { order_code?: string; step_no?: number; step_count?: number; partial_qty_total?: number; planned_quantity?: number };
  unit?: string;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (qty: number) => void;
}) {
  const [raw, setRaw] = useState("");
  const current = Number(job?.partial_qty_total) || 0;
  const plan = Number(job?.planned_quantity) || 0;
  const add = Number(raw) || 0;
  const forecast = partialForecast(current, add, plan);
  const pct = plan > 0 ? Math.min(100, Math.round((current / plan) * 100)) : 0;
  const disabled = !!busy || add <= 0 || forecast.over;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View testID="shopfloor-partial-dialog" style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "center", padding: 16 }}>
        <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 24, gap: 14 }}>
          <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>
            Ara sayım · {job?.order_code} Adım {job?.step_no}/{job?.step_count}
          </Text>
          <View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ fontSize: 14 }}>Şu ana kadar</Text>
              <Text style={{ fontSize: 14, fontWeight: "700" }}>{formatQty(current)} / {formatQty(plan)} {unit}</Text>
            </View>
            <View style={{ height: 8, borderRadius: 99, backgroundColor: "#E2E8F0", overflow: "hidden" }}>
              <View style={{ height: 8, width: `${pct}%`, backgroundColor: "#F59E0B" }} />
            </View>
            <Text testID="shopfloor-partial-forecast" style={{ marginTop: 6, fontSize: 13, fontWeight: "700", color: forecast.over ? "#BE123C" : "#047857" }}>
              {forecast.over
                ? "Plan aşılamaz"
                : `Eklenince: ${formatQty(forecast.next)} / ${formatQty(plan)} ${unit} · kalan ${formatQty(forecast.left)}`}
            </Text>
          </View>
          <Text testID="shopfloor-partial-display" style={{ fontSize: 40, fontWeight: "900", textAlign: "right", borderWidth: 2, borderColor: "#CBD5E1", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 8 }}>
            {raw || "0"}
          </Text>
          <ShopFloorNumpad value={raw} onChange={setRaw} onAccept={() => { if (!disabled) onSubmit(add); }} />
          <Text style={{ fontSize: 12, color: colors.muted }}>Sağlam adet eklenir. Plan aşılamaz; aynı giriş iki kez sayılmaz.</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={onClose} style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 2, borderColor: "#CBD5E1" }}>
              <Text style={{ fontWeight: "700" }}>Vazgeç</Text>
            </Pressable>
            <Pressable
              testID="shopfloor-partial-add"
              disabled={disabled}
              onPress={() => { if (!disabled) onSubmit(add); }}
              style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: disabled ? "#E2E8F0" : "#059669" }}
            >
              <Text style={{ fontWeight: "700", color: disabled ? "#94A3B8" : "#fff" }}>+{formatQty(add)} Ekle</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function TakeoverDialog({
  job,
  detail,
  busy,
  onClose,
  onConfirm,
}: {
  job?: { order_code?: string; step_no?: number; step_count?: number; station?: string; step_name?: string; operator_name?: string } | null;
  detail?: TakeoverDetail | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const name = String(detail?.previous_operator || job?.operator_name || "").trim();
  const when = formatShopfloorClock(detail?.last_action_at);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View testID="shopfloor-takeover-dialog" style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "center", padding: 16 }}>
        <View style={{ backgroundColor: "#fff", borderRadius: 20, padding: 24, gap: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: "#FFF7ED", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 24, fontWeight: "900", color: "#C2410C" }}>!</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 20, fontWeight: "700", color: colors.text }}>{takeoverTitle(detail, job?.operator_name)}</Text>
          </View>
          <View style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#F1F5F9", borderRadius: 12, padding: 10 }}>
            <Text style={{ fontSize: 12, color: "#475569", lineHeight: 20 }}>
              İş: <Text style={{ fontWeight: "700", color: colors.text }}>{job?.order_code} • Adım {job?.step_no}/{job?.step_count} · {job?.station || job?.step_name}</Text>
              {"\n"}Önceki operatör: <Text style={{ fontWeight: "700", color: colors.text }}>{name || "—"}</Text>
              {"\n"}Son işlem: <Text style={{ fontWeight: "700", color: colors.text }}>{when || "—"}</Text>
            </Text>
          </View>
          <Text style={{ fontSize: 12, color: colors.muted }}>Devralırsanız iş sizin adınıza devam eder; devralma kaydı denetim günlüğüne yazılır.</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={onClose} style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 2, borderColor: "#CBD5E1" }}>
              <Text style={{ fontWeight: "700" }}>Vazgeç</Text>
            </Pressable>
            <Pressable
              testID="shopfloor-takeover-confirm"
              disabled={!!busy}
              onPress={onConfirm}
              style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#059669", opacity: busy ? 0.6 : 1 }}
            >
              <Text style={{ fontWeight: "700", color: "#fff" }}>Devral ve başla</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function DrawingViewer({
  title,
  filename,
  expiresIn,
  url,
  contentType,
  onClose,
}: {
  title: string;
  filename?: string;
  expiresIn?: number;
  url?: string;
  contentType?: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const minutes = Math.max(1, Math.round(Number(expiresIn || 900) / 60));
  const image = !contentType || String(contentType).startsWith("image/");
  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View testID="shopfloor-drawing" style={{ flex: 1, backgroundColor: "#0F172A" }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, backgroundColor: "#020617", paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ color: "#fff", fontWeight: "700", flexShrink: 1 }}>Teknik çizim · {title}</Text>
          <Text style={{ color: "#94A3B8", fontSize: 13 }}>{filename || "çizim"} · bağlantı {minutes} dk geçerli</Text>
          <View style={{ flex: 1 }} />
          <Pressable accessibilityLabel="Uzaklaş" onPress={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 2, borderColor: "#334155", backgroundColor: "#1E293B" }}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>−</Text>
          </Pressable>
          <Pressable accessibilityLabel="Yakınlaş" onPress={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))} style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 2, borderColor: "#334155", backgroundColor: "#1E293B" }}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>+</Text>
          </Pressable>
          <Pressable testID="shopfloor-drawing-close" onPress={onClose} style={{ minHeight: 44, borderRadius: 12, borderWidth: 2, borderColor: "#CBD5E1", backgroundColor: "#fff", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontWeight: "700", color: colors.text }}>✕ Kapat</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
          {url ? (
            image ? (
              <Image testID="shopfloor-drawing-image" source={{ uri: url }} accessibilityLabel={filename || "Teknik çizim"} style={{ width: "100%", height: "80%", transform: [{ scale: zoom }] }} resizeMode="contain" />
            ) : (
              <Text testID="shopfloor-drawing-frame" style={{ color: "#E2E8F0" }}>{url}</Text>
            )
          ) : (
            <Text style={{ color: "#CBD5E1" }}>Çizim yükleniyor</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

export function UndoToast({ text, countdown, onUndo }: { text: string; countdown: string; onUndo: () => void }) {
  return (
    <View testID="shopfloor-undo-toast" style={{ backgroundColor: "#065F46", borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 14 }}>
      <Text style={{ color: "#fff", fontWeight: "600", flex: 1 }}>{text}</Text>
      <Pressable testID="shopfloor-undo-toast-action" onPress={onUndo} style={{ backgroundColor: "#fff", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, minHeight: 44, justifyContent: "center" }}>
        <Text style={{ color: "#065F46", fontWeight: "800" }}>Geri al ({countdown})</Text>
      </Pressable>
    </View>
  );
}

export function IdleLock({
  name,
  code,
  minutes,
  error,
  busy,
  onSubmit,
  onSwitch,
}: {
  name: string;
  code?: string;
  minutes: number;
  error?: string;
  busy?: boolean;
  onSubmit: (pin: string) => void;
  onSwitch: () => void;
}) {
  return (
    <Modal visible animationType="fade" onRequestClose={onSwitch}>
      <View testID="shopfloor-idle-lock" style={{ flex: 1, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <View style={{ width: "100%", maxWidth: 380, gap: 16 }}>
          <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center" }}>Ekran kilitlendi</Text>
          <Text style={{ color: "#94A3B8", fontSize: 14, textAlign: "center" }}>
            {minutes} dakika işlem yapılmadı · {name}{code ? ` (${code})` : ""}
          </Text>
          <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: spacing.md }}>
            <ShopfloorPinPad operatorName={name} error={error} busy={busy} onSubmit={onSubmit} onCancel={onSwitch} />
          </View>
          <Pressable testID="shopfloor-idle-switch" onPress={onSwitch} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#CBD5E1", fontWeight: "600", textDecorationLine: "underline" }}>Başka operatör</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function FocusBoard({
  mode,
  title,
  step,
  meta,
  qtyLabel,
  passive,
  onBack,
  onStart,
  onFinish,
  onDrawing,
}: {
  mode: "running" | "next";
  title: string;
  step?: string;
  meta?: string;
  qtyLabel: string;
  passive?: boolean;
  onBack: () => void;
  onStart: () => void;
  onFinish: () => void;
  onDrawing: () => void;
}) {
  const running = mode === "running";
  return (
    <Modal visible animationType="slide" onRequestClose={onBack}>
      <View testID={running ? "shopfloor-running" : "shopfloor-next-job"} style={{ flex: 1, backgroundColor: "#F1F5F9" }}>
        <View style={{ height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", backgroundColor: "#fff", paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>{running ? "Çalışıyor" : "Sıradaki iş"}</Text>
          <Pressable testID="shopfloor-focus-back" onPress={onBack} style={{ minHeight: 44, borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 8, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontWeight: "600" }}>Listeye dön</Text>
          </Pressable>
        </View>
        <View style={{ padding: 20, gap: 14 }}>
          <View style={{ borderWidth: 3, borderRadius: 12, padding: 20, borderColor: running ? "#F59E0B" : "#2563EB", backgroundColor: running ? "#FFFBEB" : "#EFF6FF", gap: 12 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ backgroundColor: running ? "#F59E0B" : "#2563EB", color: "#fff", fontWeight: "700", fontSize: 13, borderRadius: 999, overflow: "hidden", paddingHorizontal: 12, paddingVertical: 4 }}>
                {running ? "Çalışıyor" : "Hazır"}
              </Text>
              {meta ? <Text style={{ flex: 1, textAlign: "right", color: colors.muted, fontSize: 13 }}>{meta}</Text> : null}
            </View>
            <Text style={{ fontSize: 30, fontWeight: "800", color: colors.text }}>{title}</Text>
            <Text style={{ fontSize: 20 }}>Adım: <Text style={{ fontWeight: "700" }}>{step || "—"}</Text></Text>
            <Text style={{ fontSize: 36, fontWeight: "800", textAlign: "right" }}>{qtyLabel}</Text>
          </View>
          {running ? (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                testID="shopfloor-focus-finish"
                disabled={!!passive}
                onPress={() => { if (!passive) onFinish(); }}
                style={{ flex: 2, height: 100, borderRadius: 12, backgroundColor: passive ? "#E2E8F0" : "#059669", alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: passive ? "#94A3B8" : "#fff", fontSize: 28, fontWeight: "800" }}>■ BİTİR</Text>
              </Pressable>
              <View style={{ flex: 1, height: 100, borderRadius: 12, borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#fff", alignItems: "center", justifyContent: "center", padding: 8 }}>
                <Text style={{ color: "#94A3B8", fontWeight: "700", textAlign: "center" }}>Duraklat mola saatinde</Text>
              </View>
            </View>
          ) : (
            <Pressable
              testID="shopfloor-focus-start"
              disabled={!!passive}
              onPress={() => { if (!passive) onStart(); }}
              style={{ height: 100, borderRadius: 12, backgroundColor: passive ? "#E2E8F0" : "#059669", alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: passive ? "#94A3B8" : "#fff", fontSize: 28, fontWeight: "800" }}>▶ BAŞLAT</Text>
            </Pressable>
          )}
          <Pressable testID="shopfloor-focus-drawing" onPress={onDrawing} style={{ minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 18, fontWeight: "600" }}>Çizim / Resim</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function FilterMenu({
  open,
  rows,
  selectedId,
  onPick,
}: {
  open: boolean;
  rows: { id: string; label: string; count: string; wash: string; edge: string }[];
  selectedId?: string;
  onPick: (id: string) => void;
}) {
  if (!open) return null;
  return (
    <View testID="shopfloor-filter-menu" style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 14, padding: 6, gap: 2 }}>
      {rows.map((row) => {
        const active = String(row.id) === String(selectedId);
        return (
          <Pressable
            key={row.id}
            testID={`shopfloor-filter-option-${row.id}`}
            onPress={() => onPick(row.id)}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: active ? "#F1F5F9" : "transparent", minHeight: 44 }}
          >
            <View style={{ width: 12, height: 12, borderRadius: 4, borderWidth: 1, backgroundColor: row.wash, borderColor: row.edge }} />
            <Text style={{ flex: 1, fontWeight: "600", fontSize: 14 }}>{row.label}</Text>
            <Text style={{ color: "#94A3B8", fontWeight: "600", fontSize: 12 }}>{row.count}{active ? " ✓" : ""}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
