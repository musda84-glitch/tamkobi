import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { fileUrl, upload } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Card, Muted, PrimaryButton, Row } from "./kit";
import { colors, radius } from "../theme";

type UploadResult = { url?: string };

/** /files/upload görseli kaydeder ve quote/project/survey dokümanına images[] olarak ekler. */
export function ImageUploader({
  entity,
  entityId,
  images,
  onUploaded,
  editable = true,
  label = "Fotoğraflar",
  hint,
  testID = "image-uploader",
}: {
  entity: "survey" | "project" | "quote";
  entityId?: string;
  images: string[];
  onUploaded: (url: string) => void;
  editable?: boolean;
  label?: string;
  hint?: string;
  testID?: string;
}) {
  const { client, companyId } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!entityId) { setError("Önce kaydı oluşturun, sonra fotoğraf ekleyin."); return; }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      const name = asset.fileName || `photo-${Date.now()}.jpg`;
      const type = asset.mimeType || "image/jpeg";
      if (asset.file) {
        form.append("file", asset.file, name);
      } else {
        form.append("file", { uri: asset.uri, name, type } as unknown as Blob);
      }
      const res = await upload<UploadResult>(client, "/files/upload", form, {
        entity,
        entity_id: entityId,
        company_id: companyId,
      });
      if (res?.url) onUploaded(res.url);
    } catch (err) {
      setError(apiErrorMessage(err, "Fotoğraf yüklenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (fromCamera: boolean) => {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") { setError(fromCamera ? "Kamera izni verilmedi." : "Galeri izni verilmedi."); return; }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ["images"] });
      if (res.canceled || !res.assets?.length) return;
      await send(res.assets[0]);
    } catch (err) {
      setError(apiErrorMessage(err, "Fotoğraf seçilemedi."));
    }
  };

  return (
    <Card testID={testID}>
      <Muted>{label}</Muted>
      {hint ? <Muted>{hint}</Muted> : null}
      {error ? <Text style={{ color: colors.danger, fontWeight: "700" }}>{error}</Text> : null}
      {!entityId ? <Muted>Kayıt oluşturulduktan sonra fotoğraf ekleyebilirsiniz.</Muted> : null}
      <Row style={{ flexWrap: "wrap" }}>
        {images.map((img) => (
          <Pressable
            key={img}
            testID={`${testID}-img`}
            onPress={() => Linking.openURL(fileUrl(client.baseUrl, img))}
            style={{ width: 96, height: 96, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}
          >
            <Image source={{ uri: fileUrl(client.baseUrl, img) }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} />
          </Pressable>
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
          <PrimaryButton title="Galeriden seç" onPress={() => pick(false)} disabled={busy} color={colors.primary} testID={`${testID}-gallery`} />
        </>
      ) : null}
    </Card>
  );
}
