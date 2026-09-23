import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { fileUrl, post, put, upload } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors, radius } from "../theme";
import { compressPickerAsset } from "../utils/compressUploadImage";
import { appendUploadBlob, imageUploadRequest, resolveUploadBlob, uploadedImageUrl } from "../utils/formDataFile";
import { idOf } from "../utils/money";
import { photoVisibility, photoVisibilityLabel } from "../utils/assignedDuty";
import {
  appendStagePhoto,
  removeStagePhoto,
  stagePhotoCount,
  stagePhotoRows,
  SURVEY_STAGE_PHOTO_LABEL,
  type StagePhoto,
} from "../utils/stagePhotos";
import type { ProjectStage } from "../utils/projectStages";
import type { ProjectDoc } from "../utils/workDocs";
import { Muted, Row } from "./kit";

const CELL = 34;
const stageRowStyle = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 6,
  width: "100%" as const,
  minHeight: CELL,
};

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

  const setVisibility = async (url: string, visible: boolean) => {
    if (!id) return;
    try {
      const r = await post<{ stage_photos?: StagePhoto[] }>(client, `/projects/${id}/stage-photos/visibility`, { url, visible });
      onChanged({ stage_photos: r.stage_photos || project.stage_photos || [], images: project.images || [] });
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Onay kaydedilemedi."));
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
      <View testID={`${tid}-grid`} style={{ gap: 6 }}>
        {rows.map((row) => {
          const chip = row.key === "other" ? SURVEY_STAGE_PHOTO_LABEL : row.label;
          return (
            <View key={row.key} testID={`${tid}-row-${row.key}`} style={stageRowStyle}>
              <View style={{
                flexGrow: 0,
                flexShrink: 1,
                flexBasis: 96,
                maxWidth: 118,
                minWidth: 0,
                minHeight: CELL,
                backgroundColor: row.current ? colors.emerald100 : "#fff",
                borderWidth: 1,
                borderColor: row.current ? "#A7F3D0" : colors.border,
                borderRadius: 8,
                paddingHorizontal: 6,
                justifyContent: "center",
              }}>
                <Text
                  testID={`${tid}-label-${row.key}`}
                  numberOfLines={1}
                  style={{ fontWeight: "800", fontSize: 11, color: row.current ? "#047857" : colors.muted }}
                >
                  {chip}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 9, fontWeight: "700", color: row.current ? "#047857" : row.done ? "#64748B" : "#94A3B8" }}>
                  {row.current ? "şu an" : row.done ? "bitti" : row.items.length ? `${row.items.length} foto` : " "}
                </Text>
              </View>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                style={{ flex: 1, minWidth: CELL, maxHeight: CELL + 8 }}
                contentContainerStyle={{ flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 2 }}
              >
                {row.items.map((item) => (
                  <View key={item.url} style={{ position: "relative", width: CELL, height: CELL }}>
                    <Pressable
                      testID={`${tid}-thumb`}
                      onPress={() => Linking.openURL(fileUrl(client.baseUrl, item.url)).catch(() => null)}
                      style={{ width: CELL, height: CELL, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff" }}
                    >
                      <Image source={{ uri: fileUrl(client.baseUrl, item.url) }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                    </Pressable>
                    {editable ? (
                      <>
                        <Pressable
                          testID={`${tid}-remove`}
                          onPress={() => remove(item.url)}
                          style={{ position: "absolute", top: -5, right: -5, width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}
                        >
                          <Ionicons name="close" size={10} color={colors.danger} />
                        </Pressable>
                        <View style={{ position: "absolute", left: 0, right: 0, bottom: -18, flexDirection: "row", justifyContent: "center", gap: 2 }}>
                          <Pressable testID={`${tid}-show`} onPress={() => setVisibility(item.url, true)}>
                            <Text style={{ fontSize: 8, fontWeight: "800", color: photoVisibility(item) === "show" ? colors.primaryHover : colors.muted }}>Görsün</Text>
                          </Pressable>
                          <Pressable testID={`${tid}-hide`} onPress={() => setVisibility(item.url, false)}>
                            <Text style={{ fontSize: 8, fontWeight: "800", color: photoVisibility(item) === "hide" ? colors.danger : colors.muted }}>Görmesin</Text>
                          </Pressable>
                        </View>
                      </>
                    ) : (
                      <Text style={{ fontSize: 8, fontWeight: "700", color: colors.muted }}>{photoVisibilityLabel(item)}</Text>
                    )}
                  </View>
                ))}
              </ScrollView>
              {editable ? (
                <View style={{ flexDirection: "row", flexShrink: 0, gap: 4 }}>
                  <Pressable
                    testID={`${tid}-camera-${row.key}`}
                    onPress={() => pick(row, true)}
                    disabled={!!busyKey}
                    style={{ width: CELL, height: CELL, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
                  >
                    <Ionicons name={busyKey === row.key ? "hourglass-outline" : "camera-outline"} size={16} color={colors.indigo} />
                  </Pressable>
                  <Pressable
                    testID={`${tid}-gallery-${row.key}`}
                    onPress={() => pick(row, false)}
                    disabled={!!busyKey}
                    style={{ width: CELL, height: CELL, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
                  >
                    <Ionicons name="image-outline" size={16} color={colors.primary} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
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
            {row.items.filter((item) => photoVisibility(item) === "show").length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {row.items.filter((item) => photoVisibility(item) === "show").map((item) => (
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
