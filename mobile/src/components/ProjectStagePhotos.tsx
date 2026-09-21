import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { fileUrl, put, upload } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors, radius } from "../theme";
import { compressPickerAsset } from "../utils/compressUploadImage";
import { appendUploadBlob, imageUploadRequest, resolveUploadBlob, uploadedImageUrl } from "../utils/formDataFile";
import { idOf } from "../utils/money";
import {
  appendStagePhoto,
  removeStagePhoto,
  stagePhotoCount,
  stagePhotoRows,
  type StagePhoto,
} from "../utils/stagePhotos";
import type { ProjectStage } from "../utils/projectStages";
import type { ProjectDoc } from "../utils/workDocs";
import { Muted, Row } from "./kit";

export function ProjectStagePhotos({
  project,
  stages,
  editable = true,
  onChanged,
  onPreview,
  testID,
}: {
  project: ProjectDoc;
  stages: ProjectStage[];
  editable?: boolean;
  onChanged: (patch: { stage_photos: StagePhoto[]; images: string[] }) => void;
  onPreview?: () => void;
  testID?: string;
}) {
  const { client, companyId } = useAuth();
  const id = idOf(project);
  const tid = testID || `project-stage-photos-${id}`;
  const rows = stagePhotoRows(project, stages);
  const count = stagePhotoCount(project);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (stage: { key: string; label: string }, fromCamera: boolean) => {
    if (!id) { setError("Önce projeyi kaydedin."); return; }
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        setError(fromCamera ? "Kamera izni verilmedi." : "Galeri izni verilmedi.");
        return;
      }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8, exif: false })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, exif: false, mediaTypes: ["images"] });
      if (res.canceled || !res.assets?.length) return;
      setBusyKey(stage.key);
      setError(null);
      const form = new FormData();
      const compact = await compressPickerAsset(res.assets[0]);
      const { blob, name } = await resolveUploadBlob(compact);
      appendUploadBlob(form, blob, name);
      const { path, query } = imageUploadRequest("project", id, companyId, {
        stage: stage.key,
        stage_label: stage.label,
      });
      const uploaded = await upload<unknown>(client, path, form, query);
      const url = uploadedImageUrl(uploaded);
      if (!url) { setError("Fotoğraf yüklendi ama adres dönmedi."); return; }
      onChanged(appendStagePhoto(project.stage_photos, project.images, {
        url,
        stage: stage.key,
        stage_label: stage.label,
        created_at: new Date().toISOString(),
      }));
    } catch (err) {
      setError(apiErrorMessage(err, "Fotoğraf yüklenemedi."));
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (url: string) => {
    const next = removeStagePhoto(project.stage_photos, project.images, url);
    try {
      await put(client, `/projects/${id}`, next);
      onChanged(next);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Fotoğraf kaldırılamadı."));
    }
  };

  return (
    <View
      testID={tid}
      style={{
        marginTop: 8,
        backgroundColor: colors.slate50,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: 8,
        gap: 8,
      }}
    >
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={{ fontWeight: "800", color: colors.text, fontSize: 12 }}>Aşama fotoğrafları</Text>
          <Muted>Müşteri takip sayfasında, yapılan işin altında görünür.</Muted>
        </View>
        {onPreview ? (
          <Pressable onPress={onPreview} testID={`${tid}-preview`} style={{ backgroundColor: "#fff", borderWidth: 1, borderColor: "#BAE6FD", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={{ fontWeight: "800", color: "#0369A1", fontSize: 11 }}>Müşteri görünümü{count ? ` · ${count}` : ""}</Text>
          </Pressable>
        ) : null}
      </Row>
      {error ? <Text style={{ color: colors.danger, fontWeight: "700", fontSize: 12 }}>{error}</Text> : null}
      {rows.map((row) => (
        <View key={row.key} testID={`${tid}-row-${row.key}`} style={{ gap: 6 }}>
          <Row style={{ alignItems: "center", flexWrap: "wrap" }}>
            <View style={{
              backgroundColor: row.current ? colors.emerald100 : "#fff",
              borderWidth: 1,
              borderColor: row.current ? "#A7F3D0" : colors.border,
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}>
              <Text style={{ fontWeight: "800", fontSize: 11, color: row.current ? "#047857" : colors.muted }}>
                {row.label}{row.current ? " · şu an" : row.done ? " · bitti" : ""}
              </Text>
            </View>
            {row.items.map((item) => (
              <View key={item.url} style={{ position: "relative" }}>
                <Pressable
                  testID={`${tid}-thumb`}
                  onPress={() => Linking.openURL(fileUrl(client.baseUrl, item.url)).catch(() => null)}
                  style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" }}
                >
                  <Image source={{ uri: fileUrl(client.baseUrl, item.url) }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                </Pressable>
                {editable ? (
                  <Pressable
                    testID={`${tid}-remove`}
                    onPress={() => remove(item.url)}
                    style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}
                  >
                    <Ionicons name="close" size={11} color={colors.danger} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {editable && row.key !== "other" ? (
              <>
                <Pressable
                  testID={`${tid}-camera-${row.key}`}
                  onPress={() => pick(row, true)}
                  disabled={!!busyKey}
                  style={{ width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name={busyKey === row.key ? "hourglass-outline" : "camera-outline"} size={18} color={colors.indigo} />
                </Pressable>
                <Pressable
                  testID={`${tid}-gallery-${row.key}`}
                  onPress={() => pick(row, false)}
                  disabled={!!busyKey}
                  style={{ width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="image-outline" size={18} color={colors.primary} />
                </Pressable>
              </>
            ) : null}
          </Row>
        </View>
      ))}
    </View>
  );
}

export function ProjectWorkPreview({
  project,
  stages,
  testID = "project-work-preview",
}: {
  project: ProjectDoc;
  stages: ProjectStage[];
  testID?: string;
}) {
  const { client } = useAuth();
  const rows = stagePhotoRows(project, stages);
  return (
    <View testID={testID} style={{ gap: 12 }}>
      <View style={{ backgroundColor: colors.secondary, borderRadius: 16, padding: 14 }}>
        <Text style={{ color: "#94A3B8", fontSize: 10, fontWeight: "800", letterSpacing: 0.6 }}>MÜŞTERİ GÖRÜNÜMÜ</Text>
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{project.name || project.project_number}</Text>
        <Text style={{ color: "#CBD5E1", fontSize: 12 }}>{project.project_number}{project.contact_name ? ` · ${project.contact_name}` : ""}</Text>
      </View>
      <Muted>Takip linkini açan müşteri giriş yapmadan bu galeriyi görür. Fotoğraf, işin yapıldığı aşamanın altında durur.</Muted>
      {rows.map((row, i) => (
        <View key={row.key} testID={`${testID}-step-${row.key}`} style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ alignItems: "center" }}>
            <View style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: row.done ? colors.primary : row.current ? "#2563EB" : colors.slate200,
            }}>
              <Ionicons
                name={row.done ? "checkmark" : row.current ? "ellipse" : "ellipse-outline"}
                size={14}
                color={row.done || row.current ? "#fff" : colors.muted}
              />
            </View>
            {i < rows.length - 1 ? (
              <View style={{ width: 2, flex: 1, minHeight: 16, backgroundColor: row.done ? "#6EE7B7" : colors.slate200 }} />
            ) : null}
          </View>
          <View style={{ flex: 1, paddingBottom: 14 }}>
            <Text style={{ fontWeight: "800", color: row.current ? colors.text : row.done ? "#334155" : colors.muted, fontSize: 13 }}>
              {row.label}
            </Text>
            {row.current && !row.done ? <Text style={{ color: "#2563EB", fontSize: 10, fontWeight: "800" }}>ŞU ANKİ ADIM</Text> : null}
            {row.items.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {row.items.map((item) => (
                  <Pressable
                    key={item.url}
                    testID={`${testID}-img`}
                    onPress={() => Linking.openURL(fileUrl(client.baseUrl, item.url)).catch(() => null)}
                    style={{ width: 88, height: 72, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}
                  >
                    <Image source={{ uri: fileUrl(client.baseUrl, item.url) }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                {row.key === "other" ? "" : "Bu aşamada henüz fotoğraf yok."}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
