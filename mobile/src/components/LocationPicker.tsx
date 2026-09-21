import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import React, { createElement, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { Card, Field, Muted, PrimaryButton, Row } from "./kit";
import { colors } from "../theme";
import { coordValue, locationPickerSummary, mapEmbedUrl, mapsUrlFor, parseMapsUrl } from "../utils/geo";

export type LocationValue = { url: string; lat: string; lng: string };

export function LocationPicker({
  value,
  onChange,
  editable = true,
  label = "Konum",
  testID = "location-picker",
  defaultOpen = false,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  editable?: boolean;
  label?: string;
  testID?: string;
  defaultOpen?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(defaultOpen);

  const setUrl = (url: string) => {
    const parsed = parseMapsUrl(url);
    onChange(parsed ? { url, lat: String(parsed.lat), lng: String(parsed.lng) } : { ...value, url });
    setNote(parsed ? "Linkten koordinat çözüldü." : null);
  };

  const setCoord = (key: "lat" | "lng", raw: string) => {
    const next = { ...value, [key]: raw };
    if (coordValue(next.lat) != null && coordValue(next.lng) != null) {
      next.url = mapsUrlFor(next.lat, next.lng);
    }
    onChange(next);
  };

  const useMyLocation = async () => {
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { setNote("Konum izni verilmedi."); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      onChange({ lat, lng, url: mapsUrlFor(lat, lng) });
      setNote("Mevcut konum işaretlendi.");
    } catch {
      setNote("Konum alınamadı.");
    } finally {
      setBusy(false);
    }
  };

  const hasCoords = coordValue(value.lat) != null && coordValue(value.lng) != null;
  const openUrl = value.url || (hasCoords ? mapsUrlFor(value.lat, value.lng) : "");
  const summary = locationPickerSummary(value);

  return (
    <Card testID={testID}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        testID={`${testID}-toggle`}
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <View style={{ flex: 1 }}>
          <Muted>{label}</Muted>
          <Muted>{open ? "Açık — gizle" : summary}</Muted>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
      </Pressable>
      {!open && openUrl ? (
        <PrimaryButton title="Haritada aç" onPress={() => Linking.openURL(openUrl)} color={colors.primary} testID="open-location-btn" />
      ) : null}
      {open ? (
        <>
          <Field
            label="Google Maps linki (yapıştırın, koordinat otomatik çözülür)"
            testID={`${testID}-url`}
            value={value.url}
            onChangeText={setUrl}
            autoCapitalize="none"
            placeholder="https://maps.google.com/..."
            editable={editable}
          />
          <Row>
            <View style={{ flex: 1 }}>
              <Field label="Enlem (lat)" testID={`${testID}-lat`} value={value.lat} onChangeText={(v) => setCoord("lat", v)} keyboardType="decimal-pad" editable={editable} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Boylam (lng)" testID={`${testID}-lng`} value={value.lng} onChangeText={(v) => setCoord("lng", v)} keyboardType="decimal-pad" editable={editable} />
            </View>
          </Row>
          {editable ? (
            <PrimaryButton title="Konum bul / işaretle" onPress={useMyLocation} loading={busy} color={colors.indigo} testID="use-my-location-btn" />
          ) : null}
          {openUrl ? (
            <PrimaryButton title="Haritada aç" onPress={() => Linking.openURL(openUrl)} color={colors.primary} testID="open-location-btn" />
          ) : null}
          {note ? <Muted>{note}</Muted> : null}
          {hasCoords && Platform.OS === "web"
            ? createElement("iframe", {
                title: "map",
                src: mapEmbedUrl(value.lat, value.lng),
                "data-testid": `${testID}-preview`,
                loading: "lazy",
                style: { width: "100%", height: 180, border: `1px solid ${colors.border}`, borderRadius: 12 },
              })
            : null}
        </>
      ) : null}
    </Card>
  );
}
