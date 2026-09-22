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
  const title = label ?? copy.label;
  const help = hint ?? copy.hint;

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
              onPress={() => Linking.openURL(fileUrl(client.baseUrl, img))}
              style={{ width: "100%", height: "100%" }}
            >
              <Image source={{ uri: fileUrl(client.baseUrl, img) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} />
            </Pressable>
            {editable && onRemoved ? (
              <Pressable
                testID={`${testID}-remove`}
                accessibilityLabel="Fotoğrafı sil"
                onPress={() => confirmAction("Fotoğraf", "Bu fotoğraf silinsin mi?", () => onRemoved(img))}
                hitSlop={10}
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: "#fff",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Ionicons name="trash" size={10} color={colors.danger} />
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
