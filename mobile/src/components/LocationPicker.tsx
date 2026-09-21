import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import React, { createElement, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Card, Field, Muted, PrimaryButton, Row } from "./kit";
import { colors, radius } from "../theme";
import { coordValue, locationPickerSummary, mapEmbedUrl, mapsUrlFor, parseMapsUrl } from "../utils/geo";

export type LocationValue = { url: string; lat: string; lng: string };

function LocationFields({
  value,
  editable,
  testID,
  busy,
  note,
  hasCoords,
  openUrl,
  setUrl,
  setCoord,
  useMyLocation,
}: {
  value: LocationValue;
  editable: boolean;
  testID: string;
  busy: boolean;
  note: string | null;
  hasCoords: boolean;
  openUrl: string;
  setUrl: (url: string) => void;
  setCoord: (key: "lat" | "lng", raw: string) => void;
  useMyLocation: () => void;
}) {
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
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
    </View>
  );
}

export function LocationPicker({
  value,
  onChange,
  editable = true,
  label = "Konum",
  testID = "location-picker",
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  editable?: boolean;
  label?: string;
  testID?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const setUrl = (url: string) => {
    const parsed = parseMapsUrl(url);
    onChange(parsed ? { url, lat: String(parsed.lat), lng: String(parsed.lng) } : { ...value, url });
    setNote(parsed ? "Linkten koordinat çözüldü." : null);
    setOpen(true);
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
  const fields = (
    <LocationFields
      value={value}
      editable={editable}
      testID={testID}
      busy={busy}
      note={note}
      hasCoords={hasCoords}
      openUrl={openUrl}
      setUrl={setUrl}
      setCoord={setCoord}
      useMyLocation={useMyLocation}
    />
  );

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40 }}>
      <Ionicons name="location-outline" size={18} color="#E11D48" />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>{summary === "Kapalı" ? "Dokunarak aç / gizle" : summary}</Text>
      </View>
      <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
    </View>
  );

  if (Platform.OS === "web") {
    return createElement(
      "details",
      {
        "data-testid": testID,
        onToggle: (e: { currentTarget: { open?: boolean } }) => setOpen(!!e.currentTarget.open),
        style: {
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.lg,
          padding: 12,
        },
      },
      createElement(
        "summary",
        {
          "data-testid": `${testID}-toggle`,
          style: { cursor: "pointer", listStyle: "none" },
        },
        header,
      ),
      fields,
    );
  }

  return (
    <Card testID={testID}>
      <Pressable onPress={() => setOpen((v) => !v)} testID={`${testID}-toggle`}>
        {header}
      </Pressable>
      {open ? fields : null}
    </Card>
  );
}
