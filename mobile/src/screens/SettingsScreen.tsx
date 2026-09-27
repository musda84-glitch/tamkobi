import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { get, post, upload } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { EmployeeAvatar } from "../components/EmployeeAvatar";
import { Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Screen } from "../components/kit";
import { colors } from "../theme";
import { passwordChangePayload, validatePasswordChange } from "../utils/account";
import { compressPickerAsset } from "../utils/compressUploadImage";
import {
  appendUploadBlob,
  imageUploadRequest,
  pickBrowserImages,
  resolveUploadBlob,
  uploadedImageUrl,
} from "../utils/formDataFile";
import { idOf } from "../utils/money";
import { playTamkobiNotify, unlockTamkobiNotify } from "../utils/notifySound";
import { getStoredPushToken, presentLocalNotification, registerDevicePush, type PushStatus } from "../utils/pushRegister";

type MeEmployee = {
  id?: string;
  _id?: string;
  full_name?: string;
  photo_url?: string | null;
};

export function SettingsScreen() {
  const { client, companies, activeCompany, switchCompany, companyId, user, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus>("idle");
  const [pushBusy, setPushBusy] = useState(false);
  const [me, setMe] = useState<MeEmployee | null>(null);

  const linkedEmployee = Boolean(user?.employee_id);
  const empId = String(user?.employee_id || idOf(me) || "").trim();

  const loadMe = useCallback(async () => {
    if (!linkedEmployee) {
      setMe(null);
      return;
    }
    try {
      const r = await get<{ employee?: MeEmployee | null }>(client, "/personnel/me");
      setMe(r?.employee || null);
    } catch {
      setMe(null);
    }
  }, [client, linkedEmployee]);

  useEffect(() => {
    getStoredPushToken().then((t) => setPushStatus(t ? "ok" : Platform.OS === "web" ? "web" : "idle"));
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const savePassword = async () => {
    const invalid = validatePasswordChange(current, next, confirm);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ message?: string }>(client, "/auth/change-password", passwordChangePayload(current, next));
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage(r?.message || "Şifreniz güncellendi.");
    } catch (err) {
      setError(apiErrorMessage(err, "Şifre değiştirilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const uploadSelfPhoto = async (fromCamera: boolean) => {
    if (!empId) {
      setError("Hesabınıza bağlı personel kartı yok.");
      return;
    }
    setPhotoBusy(true);
    setError(null);
    try {
      let assets: { uri?: string; fileName?: string | null; mimeType?: string | null; file?: Blob }[] = [];
      if (!fromCamera && Platform.OS === "web") {
        assets = await pickBrowserImages(undefined, false);
      } else {
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
        assets = res.assets;
      }
      if (!assets.length) return;
      const form = new FormData();
      const compact = await compressPickerAsset(assets[0]);
      const { blob, name } = await resolveUploadBlob(compact);
      appendUploadBlob(form, blob, name);
      const { path, query } = imageUploadRequest("employee", empId, companyId);
      const res = await upload<unknown>(client, path, form, query);
      const url = uploadedImageUrl(res);
      if (!url) throw new Error("Fotoğraf adresi dönmedi.");
      setMe((prev) => ({ ...(prev || {}), id: empId, photo_url: url }));
      setMessage("Fotoğrafınız güncellendi.");
    } catch (err) {
      setError(apiErrorMessage(err, "Fotoğraf yüklenemedi."));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <Screen>
      <H1>Ayarlar</H1>
      <Muted>{user?.email} · {user?.role_name || user?.role}</Muted>
      <ErrorBanner message={error} />
      {message ? <Card><Text style={{ color: colors.accent, fontWeight: "700" }}>{message}</Text></Card> : null}

      {linkedEmployee ? (
        <Card testID="settings-self-photo">
          <Text style={{ fontWeight: "800", color: colors.text }}>Profil fotoğrafı</Text>
          <Muted>Personel kartınızda ve Mesaim ekranında görünür.</Muted>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingTop: 4 }}>
            <EmployeeAvatar
              name={me?.full_name || user?.name}
              photoUrl={me?.photo_url}
              size={64}
              testID="settings-self-photo-avatar"
            />
            <View style={{ flex: 1, gap: 8 }}>
              <PrimaryButton
                title={photoBusy ? "Yükleniyor…" : "Galeriden seç"}
                testID="settings-self-photo-gallery"
                onPress={() => uploadSelfPhoto(false)}
                loading={photoBusy}
                color={colors.primary}
              />
              {Platform.OS !== "web" ? (
                <Pressable
                  testID="settings-self-photo-camera"
                  onPress={() => uploadSelfPhoto(true)}
                  disabled={photoBusy}
                  style={{ paddingVertical: 6 }}
                >
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>Kamera ile çek</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Card>
      ) : null}

      <Card testID="settings-change-password">
        <Text style={{ fontWeight: "800", color: colors.text }}>Şifre yenile</Text>
        <Muted>Mevcut şifre doğrulanır. Yeni şifre en az 6 karakter olmalı.</Muted>
        <Field label="Mevcut şifre" testID="settings-pw-current" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
        <Field label="Yeni şifre" testID="settings-pw-new" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label="Yeni şifre (tekrar)" testID="settings-pw-confirm" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <PrimaryButton title="Şifreyi değiştir" testID="settings-pw-save" onPress={savePassword} loading={busy} color={colors.primary} />
      </Card>

      <Card testID="settings-push">
        <Text style={{ fontWeight: "800", color: colors.text }}>Telefon bildirimleri</Text>
        <Muted>
          {pushStatus === "ok"
            ? "Bu cihazda açık. Yeni kayıtlar TamKobi çanı ile bildirim çubuğuna düşer."
            : pushStatus === "web"
              ? "Tarayıcıda yeni bildirim TamKobi çanı çalar. Sistem tepsisi için Android / iOS uygulamasını kullanın."
              : pushStatus === "denied"
                ? "Bildirim izni kapalı. Telefondan izin verip yeniden deneyin."
                : "İzin açıksa bekleyen ve yeni bildirimler TamKobi çanı ile telefona da yazılır. Uygulamayı bir kez açın."}
        </Muted>
        {Platform.OS === "web" ? (
          <PrimaryButton
            title="TamKobi bildirim sesini dinle"
            testID="settings-notify-sound"
            onPress={() => {
              unlockTamkobiNotify();
              playTamkobiNotify();
              setMessage("TamKobi bildirim sesi çalındı.");
            }}
            color={colors.primary}
          />
        ) : (
          <PrimaryButton
            title={pushBusy ? "Açılıyor…" : "Bildirimleri aç"}
            testID="settings-push-enable"
            onPress={async () => {
              setPushBusy(true);
              try {
                const r = await registerDevicePush(client);
                setPushStatus(r.status === "ok" ? "ok" : r.status);
                const local = await presentLocalNotification({
                  title: "TamKobi",
                  body: "Telefon bildirimleri açık. Uygulama içi kayıtlar buraya da düşer.",
                  data: { link: "/notifications" },
                });
                if (r.status === "denied") setError("Bildirim izni verilmedi.");
                else if (local) setMessage("Telefon bildirimi gönderildi. Bildirim çubuğunu kontrol edin.");
                else setError(r.error || "Telefon bildirimi gösterilemedi.");
              } finally {
                setPushBusy(false);
              }
            }}
            loading={pushBusy}
            color={colors.indigo}
          />
        )}
      </Card>

      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Aktif şirket</Text>
        {companies.map((c) => {
          const id = idOf(c);
          const active = id === idOf(activeCompany);
          return (
            <Pressable key={id} onPress={() => switchCompany(id)} style={{ paddingVertical: 10 }}>
              <Text style={{ fontWeight: active ? "800" : "600", color: active ? colors.primary : colors.text }}>{c.name}{active ? "  ✓" : ""}</Text>
            </Pressable>
          );
        })}
      </Card>
      <PrimaryButton title="Çıkış yap" onPress={() => logout()} color={colors.danger} />
    </Screen>
  );
}
