import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";
import { fileUrl, upload } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import {
  DUTY_MAPS_ACTION,
  dutyHasProject,
  dutyPhotos,
  dutyWorkflow,
  dutyWorkflowProgress,
  photoVisibilityLabel,
  type AssignedDuty,
} from "../utils/assignedDuty";
import { compressPickerAsset } from "../utils/compressUploadImage";
import { appendUploadBlob, pickBrowserImage, resolveUploadBlob } from "../utils/formDataFile";
import { mapsLink } from "../utils/geo";
import { Badge, Card, Muted, PrimaryButton, Row } from "./kit";

export function AssignedDutyCard({
  duty,
  index = 0,
  onApprove,
  onChanged,
  approveBusy = false,
  showAtolye = false,
  onAtolye,
  testID,
}: {
  duty: AssignedDuty;
  index?: number;
  onApprove?: () => void;
  onChanged?: (next?: AssignedDuty) => void;
  approveBusy?: boolean;
  showAtolye?: boolean;
  onAtolye?: () => void;
  testID?: string;
}) {
  const { client } = useAuth();
  const tid = testID || `duty-${duty.id || index}`;
  const [openFlow, setOpenFlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flow = dutyWorkflow(duty);
  const progress = dutyWorkflowProgress(duty);
  const photos = dutyPhotos(duty);
  const mapHref = mapsLink(duty);
  const canMap = dutyHasProject(duty) && Boolean(mapHref);

  const pickPhoto = async () => {
    if (!duty.id) { setError("Görev numarası yok."); return; }
    try {
      let asset: { uri?: string; fileName?: string | null; mimeType?: string | null; file?: Blob } | null = null;
      if (Platform.OS === "web") {
        asset = await pickBrowserImage();
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== "granted") { setError("Galeri izni verilmedi."); return; }
        const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, exif: false, mediaTypes: ["images"] });
        if (res.canceled || !res.assets?.length) return;
        asset = res.assets[0];
      }
      if (!asset) return;
      setBusy(true);
      setError(null);
      const form = new FormData();
      const compact = await compressPickerAsset(asset);
      const { blob, name } = await resolveUploadBlob(compact);
      appendUploadBlob(form, blob, name);
      const r = await upload<{ message?: string; task?: AssignedDuty }>(client, `/personnel/me/tasks/${duty.id}/photos`, form);
      onChanged?.(r.task);
    } catch (err) {
      setError(apiErrorMessage(err, "Fotoğraf yüklenemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID={tid} style={duty.done ? { opacity: 0.75 } : undefined}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "800", color: colors.text }} numberOfLines={2}>{duty.title || "Görev"}</Text>
          <Muted>
            {[duty.project_number, duty.project_name || duty.park_name].filter(Boolean).join(" · ")}
          </Muted>
        </View>
        <Badge label={duty.done ? "Tamam" : "Açık"} tone={duty.done ? "green" : "indigo"} />
      </Row>
      {error ? <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 12 }}>{error}</Text> : null}
      {canMap ? (
        <PrimaryButton
          title={DUTY_MAPS_ACTION}
          onPress={() => {
            if (!mapHref) { Alert.alert("Konum yok", "Bu projeye konum veya adres eklenmemiş."); return; }
            Linking.openURL(mapHref).catch(() => Alert.alert("Harita açılamadı", "Konum linki açılamadı."));
          }}
          color="#BE123C"
          testID={`${tid}-maps`}
        />
      ) : null}
      {flow.length ? (
        <View>
          <Pressable testID={`${tid}-flow-toggle`} onPress={() => setOpenFlow((v) => !v)}>
            <Muted>İş akışı {progress.done}/{progress.total}{openFlow ? " · gizle" : " · göster"}</Muted>
          </Pressable>
          {openFlow ? (
            <View testID={`${tid}-flow`} style={{ gap: 6, marginTop: 6 }}>
              {flow.map((step, i) => (
                <Text key={step.id || String(i)} style={{ fontSize: 12, color: step.done ? colors.primaryHover : colors.text, fontWeight: "600" }}>
                  {step.done ? "✓" : "○"} {step.title}
                  {step.assignee_name ? ` · ${step.assignee_name}` : ""}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {dutyHasProject(duty) ? (
        <View style={{ gap: 8 }}>
          <Muted>İş fotoğrafları — müşteri görmesi yönetici onayına bağlı</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {photos.map((p) => (
              <View key={p.url} style={{ width: 64 }}>
                <Image source={{ uri: fileUrl(client.baseUrl, p.url) }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: colors.slate100 }} />
                <Text style={{ fontSize: 9, fontWeight: "700", color: colors.muted, marginTop: 2 }} numberOfLines={2}>
                  {photoVisibilityLabel(p)}
                </Text>
              </View>
            ))}
          </View>
          {!duty.done ? (
            <PrimaryButton
              title={busy ? "Yükleniyor…" : "İş fotoğrafı yükle"}
              onPress={pickPhoto}
              disabled={busy}
              color={colors.indigo}
              testID={`${tid}-photo`}
            />
          ) : null}
        </View>
      ) : null}
      {!duty.done ? (
        <Row>
          {showAtolye && onAtolye ? (
            <View style={{ flex: 1 }}>
              <PrimaryButton title="Atölyeye git" onPress={onAtolye} color={colors.indigo} testID={`${tid}-atolye`} />
            </View>
          ) : null}
          {onApprove ? (
            <View style={{ flex: 1 }}>
              <PrimaryButton title={approveBusy ? "Onaylanıyor…" : "Onayla"} onPress={onApprove} disabled={approveBusy} loading={approveBusy} color={colors.primary} testID={`${tid}-approve`} />
            </View>
          ) : null}
        </Row>
      ) : (
        <Muted>Görev onaylandı.</Muted>
      )}
    </Card>
  );
}
