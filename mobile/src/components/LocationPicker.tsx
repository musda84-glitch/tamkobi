import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import React, { createElement, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Card, Field, Muted, PrimaryButton, Row } from "./kit";
import { colors, radius } from "../theme";
import {
  coordValue,
  DEFAULT_LOCATION_RADIUS_M,
  LOCATION_RADIUS_OPTIONS,
  locationPickerSummary,
  mapEmbedUrl,
  mapsUrlFor,
  normalizeRadiusM,
  parseMapsUrl,
} from "../utils/geo";

export type LocationValue = { url: string; lat: string; lng: string; radius_m?: number };

function RadiusChips({
  value,
  editable,
  testID,
  onChange,
}: {
  value: number;
  editable: boolean;
  testID: string;
  onChange: (n: number) => void;
}) {
  const current = normalizeRadiusM(value);
  return (
    <View style={{ gap: 6 }} testID={`${testID}-radius`}>
      <Text style={{ fontWeight: "700", color: colors.text, fontSize: 12 }}>Giriş mesafesi (yarıçap)</Text>
      <Muted>Personel bu noktanın kaç metre içinden mesai girişi yapabilir.</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {LOCATION_RADIUS_OPTIONS.map((m) => {
          const on = current === m;
          return (
            <Pressable
              key={m}
              disabled={!editable}
              onPress={() => onChange(m)}
              testID={`${testID}-radius-${m}`}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: on ? colors.indigo : colors.border,
                backgroundColor: on ? colors.indigo50 : colors.surface,
                opacity: editable ? 1 : 0.6,
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 12, color: on ? colors.indigo : colors.muted }}>{m} m</Text>
            </Pressable>
          );
        })}
      </View>
      {editable ? (
        <Field
          label="Özel mesafe (m)"
          testID={`${testID}-radius-custom`}
          value={String(current)}
          onChangeText={(v) => {
            const n = Math.trunc(Number(String(v).replace(",", ".")));
            if (Number.isFinite(n) && n >= 25) onChange(Math.min(5000, n));
          }}
          keyboardType="number-pad"
          editable={editable}
        />
      ) : (
        <Muted testID={`${testID}-radius-label`}>{current} m</Muted>
      )}
    </View>
  );
}

function LocationFields({
  value,
  editable,
  testID,
  busy,
  note,
  hasCoords,
  openUrl,
  showRadius,
  setUrl,
  setCoord,
  setRadius,
  useMyLocation,
}: {
  value: LocationValue;
  editable: boolean;
  testID: string;
  busy: boolean;
  note: string | null;
  hasCoords: boolean;
  openUrl: string;
  showRadius: boolean;
  setUrl: (url: string) => void;
  setCoord: (key: "lat" | "lng", raw: string) => void;
  setRadius: (n: number) => void;
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
      {showRadius ? (
        <RadiusChips
          value={normalizeRadiusM(value.radius_m)}
          editable={editable}
          testID={testID}
          onChange={setRadius}
        />
      ) : null}
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
  showRadius = false,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  editable?: boolean;
  label?: string;
  testID?: string;
  /** Proje / keşif: giriş yarıçapı (metre) seçilebilir. */
  showRadius?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const withRadius = (next: LocationValue): LocationValue => {
    if (!showRadius) return next;
    return { ...next, radius_m: normalizeRadiusM(next.radius_m ?? value.radius_m ?? DEFAULT_LOCATION_RADIUS_M) };
  };

  const setUrl = (url: string) => {
    const parsed = parseMapsUrl(url);
    onChange(withRadius(parsed ? { url, lat: String(parsed.lat), lng: String(parsed.lng) } : { ...value, url }));
    setNote(parsed ? "Linkten koordinat çözüldü." : null);
    setOpen(true);
  };

  const setCoord = (key: "lat" | "lng", raw: string) => {
    const next = { ...value, [key]: raw };
    if (coordValue(next.lat) != null && coordValue(next.lng) != null) {
      next.url = mapsUrlFor(next.lat, next.lng);
    }
    onChange(withRadius(next));
  };

  const setRadius = (n: number) => {
    onChange(withRadius({ ...value, radius_m: normalizeRadiusM(n) }));
  };

  const useMyLocation = async () => {
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") { setNote("Konum izni verilmedi."); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      onChange(withRadius({ lat, lng, url: mapsUrlFor(lat, lng) }));
      setNote(showRadius
        ? `Mevcut konum işaretlendi · giriş ${normalizeRadiusM(value.radius_m)} m.`
        : "Mevcut konum işaretlendi.");
    } catch {
      setNote("Konum alınamadı.");
    } finally {
      setBusy(false);
    }
  };

  const hasCoords = coordValue(value.lat) != null && coordValue(value.lng) != null;
  const openUrl = value.url || (hasCoords ? mapsUrlFor(value.lat, value.lng) : "");
  const summary = locationPickerSummary(showRadius ? withRadius(value) : value);
  const fields = (
    <LocationFields
      value={showRadius ? withRadius(value) : value}
      editable={editable}
      testID={testID}
      busy={busy}
      note={note}
      hasCoords={hasCoords}
      openUrl={openUrl}
      showRadius={showRadius}
      setUrl={setUrl}
      setCoord={setCoord}
      setRadius={setRadius}
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
