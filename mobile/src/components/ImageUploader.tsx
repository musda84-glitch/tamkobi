import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import React, { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { fileUrl, upload } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { confirmAction } from "./chips";
import { Card, Muted, PrimaryButton, Row } from "./kit";
import { colors, radius } from "../theme";
import { compressPickerAsset } from "../utils/compressUploadImage";
import {
  appendUploadBlob,
  imageUploadRequest,
  imageUploaderCopy,
  pickBrowserImages,
  resolveUploadBlob,
  uploadedImageUrl,
  type ImageEntity,
  type PickerAssetLike,
} from "../utils/formDataFile";

/** Keşif/proje/teklif: /files/upload. Stok kartı: /products/:id/image. Expo fetch Blob ister. */
export function ImageUploader({
  entity,
  entityId,
  images,
  onUploaded,
  onRemoved,
  editable = true,
  label,
  hint,
  testID = "image-uploader",
}: {
  entity: ImageEntity;
  entityId?: string;
  images: string[];
  onUploaded: (url: string) => void;
  onRemoved?: (url: string) => void;
  editable?: boolean;
  label?: string;
  hint?: string;
  testID?: string;
}) {
  const { client, companyId } = useAuth();
  const copy = imageUploaderCopy(entity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const title = label ?? copy.label;
  const help = hint ?? copy.hint;
  const canRemove = editable && !!onRemoved;

  const sendAll = async (assets: PickerAssetLike[]) => {
    if (!entityId) { setError("Önce kaydı oluşturun, sonra fotoğraf ekleyin."); return; }
    if (!assets.length) return;
    setBusy(true);
    setError(null);
    try {
      let ok = 0;
      let lastErr = "";
      for (const asset of assets) {
        try {
          const form = new FormData();
          const compact = await compressPickerAsset(asset);
          const { blob, name } = await resolveUploadBlob(compact);
          appendUploadBlob(form, blob, name);
          const { path, query } = imageUploadRequest(entity, entityId, companyId);
          const res = await upload<unknown>(client, path, form, query);
          const url = uploadedImageUrl(res);
          if (url) {
            onUploaded(url);
            ok += 1;
          } else {
            lastErr = "Fotoğraf yüklendi ama adres dönmedi.";
          }
        } catch (err) {
          lastErr = apiErrorMessage(err, "Fotoğraf yüklenemedi.");
        }
      }
      if (!ok && lastErr) setError(lastErr);
      else if (lastErr) setError(`${ok} fotoğraf yüklendi. ${lastErr}`);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (fromCamera: boolean) => {
    try {
      if (!fromCamera && Platform.OS === "web") {
        const assets = await pickBrowserImages();
        await sendAll(assets);
        return;
      }
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") { setError(fromCamera ? "Kamera izni verilmedi." : "Galeri izni verilmedi."); return; }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8, exif: false })
        : await ImagePicker.launchImageLibraryAsync({
          quality: 0.8,
          exif: false,
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
        });
      if (res.canceled || !res.assets?.length) return;
      await sendAll(res.assets);
    } catch (err) {
      setError(apiErrorMessage(err, "Fotoğraf seçilemedi."));
    }
  };

  return (
    <Card testID={testID}>
      <Muted>{title}</Muted>
      {help ? <Muted>{help}</Muted> : null}
      {canRemove ? <Muted>Silmek için fotoğrafa basılı tutun.</Muted> : null}
      {error ? <Text style={{ color: colors.danger, fontWeight: "700" }}>{error}</Text> : null}
      {!entityId ? <Muted>Kayıt oluşturulduktan sonra fotoğraf ekleyebilirsiniz.</Muted> : null}
      <Row style={{ flexWrap: "wrap" }}>
        {images.map((img) => (
          <View
            key={img}
            style={{ width: 96, height: 96, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}
          >
            <Pressable
              testID={`${testID}-img`}
              accessibilityHint={canRemove ? "Silmek için basılı tutun" : undefined}
              delayLongPress={350}
              onLongPress={canRemove ? () => setPendingRemove(img) : undefined}
              onPress={() => {
                if (pendingRemove === img) {
                  setPendingRemove(null);
                  return;
                }
                void Linking.openURL(fileUrl(client.baseUrl, img));
              }}
              style={{ width: "100%", height: "100%" }}
            >
              <Image source={{ uri: fileUrl(client.baseUrl, img) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} />
            </Pressable>
            {canRemove && pendingRemove === img ? (
              <Pressable
                onPress={() => setPendingRemove(null)}
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(0,0,0,0.45)",
                }}
              >
                <Pressable
                  testID={`${testID}-remove`}
                  accessibilityLabel="Fotoğrafı sil"
                  onPress={() => confirmAction("Fotoğraf", "Bu fotoğraf silinsin mi?", () => {
                    onRemoved?.(img);
                    setPendingRemove(null);
                  })}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: "#fff",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="trash" size={18} color={colors.danger} />
                </Pressable>
              </Pressable>
            ) : null}
          </View>
        ))}
        {!images.length ? (
          <View style={{ width: 96, height: 96, borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="image-outline" size={22} color={colors.muted} />
          </View>
        ) : null}
      </Row>
      {editable && entityId ? (
        <>
          <PrimaryButton title={busy ? "Yükleniyor…" : "Fotoğraf çek"} onPress={() => pick(true)} loading={busy} color={colors.indigo} testID={`${testID}-camera`} />
          <PrimaryButton title={busy ? "Yükleniyor…" : "Galeriden seç"} onPress={() => pick(false)} disabled={busy} color={colors.primary} testID={`${testID}-gallery`} />
        </>
      ) : null}
    </Card>
  );
}
