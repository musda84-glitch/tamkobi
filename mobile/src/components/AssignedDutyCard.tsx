import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Alert, Linking, Platform, Pressable, Text, View } from "react-native";
import { fileUrl, post, upload } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import {
  DUTY_ATOLYE_ACTION,
  DUTY_COMPLETE_CONFIRM,
  dutyCompleteTitle,
  DUTY_PHOTO_HIDE,
  DUTY_PHOTO_SHOW,
  DUTY_SITE_ACTION,
  applyDutyPhotoVisibility,
  dutyCanShowPhotos,
  dutyCanUploadPhotos,
  dutyIsField,
  dutyPhotosHint,
  dutyKindLabel,
  dutyPhotos,
  dutyShowAtolye,
  dutyShowSite,
  dutySiteHint,
  dutyWorkflow,
  dutyWorkflowProgress,
  photoVisibility,
  photoVisibilityLabel,
  type AssignedDuty,
  type DutyPhoto,
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
  reviewPhotos = false,
  testID,
}: {
  duty: AssignedDuty;
  index?: number;
  onApprove?: () => void;
  onChanged?: (next?: AssignedDuty) => void;
  approveBusy?: boolean;
  showAtolye?: boolean;
  onAtolye?: () => void;
  reviewPhotos?: boolean;
  testID?: string;
}) {
  const { client } = useAuth();
  const tid = testID || `duty-${duty.id || index}`;
  const [openFlow, setOpenFlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [visBusy, setVisBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flow = dutyWorkflow(duty);
  const progress = dutyWorkflowProgress(duty);
  const photos = dutyPhotos(duty);
  const mapHref = mapsLink(duty);
  const field = dutyIsField(duty);
  const showWorkshop = dutyShowAtolye(duty, showAtolye) && Boolean(onAtolye);
  const showSite = dutyShowSite(duty);
  const canReview = reviewPhotos && field && Boolean(duty.project_id);

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

  const openSite = () => {
    if (mapHref) {
      Linking.openURL(mapHref).catch(() => Alert.alert("Harita açılamadı", "Konum linki açılamadı."));
      return;
    }
    Alert.alert("Görev yeri", dutySiteHint(duty));
  };

  const confirmApprove = () => {
    if (!onApprove) return;
    if (Platform.OS === "web") {
      const ok = typeof window !== "undefined" && window.confirm(DUTY_COMPLETE_CONFIRM);
      if (ok) onApprove();
      return;
    }
    Alert.alert("Görevi onayla", DUTY_COMPLETE_CONFIRM, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Onayla", onPress: onApprove },
    ]);
  };

  const setVisibility = async (photo: DutyPhoto, visible: boolean) => {
    if (!duty.project_id) { setError("Proje numarası yok."); return; }
    try {
      setVisBusy(`${photo.url}:${visible ? "show" : "hide"}`);
      setError(null);
      await post(client, `/projects/${duty.project_id}/stage-photos/visibility`, { url: photo.url, visible });
      onChanged?.({ ...duty, photos: applyDutyPhotoVisibility(duty.photos || photos, photo.url, visible) });
    } catch (err) {
      setError(apiErrorMessage(err, "Onay kaydedilemedi."));
    } finally {
      setVisBusy(null);
    }
  };

  return (
    <Card testID={tid} style={duty.done ? { borderColor: colors.primary, backgroundColor: colors.emerald50 } : undefined}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "800", color: colors.text }} numberOfLines={2}>{duty.title || "Görev"}</Text>
          <Muted>
            {[dutyKindLabel(duty), duty.project_number, duty.project_name || duty.park_name].filter(Boolean).join(" · ")}
          </Muted>
        </View>
        <Badge label={duty.done ? "Tamam" : "Açık"} tone={duty.done ? "green" : "indigo"} />
      </Row>
      {error ? <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 12 }}>{error}</Text> : null}
      {showSite ? (
        <View style={{ gap: 4 }}>
          <PrimaryButton
            title={DUTY_SITE_ACTION}
            onPress={openSite}
            color="#BE123C"
            testID={`${tid}-maps`}
          />
          <Muted testID={`${tid}-site-hint`}>{dutySiteHint(duty)}</Muted>
        </View>
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
      {dutyCanShowPhotos(duty) || (reviewPhotos && photos.length) ? (
        <View style={{ gap: 8 }} testID={`${tid}-photos`}>
          <Muted>{dutyPhotosHint(duty)}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {photos.map((p) => {
              const vis = photoVisibility(p);
              return (
                <View key={p.url} style={{ width: reviewPhotos ? 88 : 64 }} testID={`${tid}-photo-${p.url}`}>
                  <Pressable
                    testID={`${tid}-photo-open`}
                    onPress={() => Linking.openURL(fileUrl(client.baseUrl, p.url)).catch(() => null)}
                  >
                    <Image source={{ uri: fileUrl(client.baseUrl, p.url) }} style={{ width: reviewPhotos ? 88 : 64, height: reviewPhotos ? 88 : 64, borderRadius: 8, backgroundColor: colors.slate100 }} />
                  </Pressable>
                  <Text style={{ fontSize: 9, fontWeight: "700", color: vis === "show" ? colors.primaryHover : vis === "hide" ? colors.danger : colors.muted, marginTop: 2 }} numberOfLines={2}>
                    {photoVisibilityLabel(p)}
                  </Text>
                  {canReview ? (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                      <Pressable
                        testID={`${tid}-photo-show`}
                        disabled={!!visBusy}
                        onPress={() => setVisibility(p, true)}
                      >
                        <Text style={{ fontSize: 10, fontWeight: "800", color: vis === "show" ? colors.primaryHover : colors.muted }}>
                          {visBusy === `${p.url}:show` ? "…" : DUTY_PHOTO_SHOW}
                        </Text>
                      </Pressable>
                      <Pressable
                        testID={`${tid}-photo-hide`}
                        disabled={!!visBusy}
                        onPress={() => setVisibility(p, false)}
                      >
                        <Text style={{ fontSize: 10, fontWeight: "800", color: vis === "hide" ? colors.danger : colors.muted }}>
                          {visBusy === `${p.url}:hide` ? "…" : DUTY_PHOTO_HIDE}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
            {!photos.length && reviewPhotos ? <Muted>Henüz iş fotoğrafı yok.</Muted> : null}
          </View>
          {dutyCanUploadPhotos(duty, reviewPhotos) ? (
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
      {showWorkshop || onApprove || duty.done ? (
        <Row>
          {showWorkshop && !duty.done ? (
            <View style={{ flex: 1 }}>
              <PrimaryButton title={DUTY_ATOLYE_ACTION} onPress={onAtolye} color={colors.indigo} testID={`${tid}-atolye`} />
            </View>
          ) : null}
          {duty.done ? (
            <View
              testID={`${tid}-approved`}
              style={{
                flex: 1,
                backgroundColor: colors.primary,
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 6,
              }}
            >
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{dutyCompleteTitle({ done: true })}</Text>
            </View>
          ) : onApprove ? (
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title={dutyCompleteTitle({ busy: approveBusy })}
                onPress={confirmApprove}
                disabled={approveBusy}
                loading={approveBusy}
                color={colors.primary}
                testID={`${tid}-approve`}
              />
            </View>
          ) : null}
        </Row>
      ) : null}
    </Card>
  );
}
