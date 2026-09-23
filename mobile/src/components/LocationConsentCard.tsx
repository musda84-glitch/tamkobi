import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "../theme";
import {
  locationConsentAccepted,
  normalizeLocationConsent,
  validateLocationConsent,
  type LocationConsent,
  type LocationSignal,
} from "../utils/locationConsent";
import { Card, Muted, PrimaryButton } from "./kit";
import { LocationSignalDot } from "./LocationSignal";

function CheckRow({
  checked,
  onToggle,
  title,
  text,
  testID,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  text: string;
  testID: string;
}) {
  return (
    <Pressable testID={testID} onPress={onToggle} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? colors.primary : colors.border,
          backgroundColor: checked ? colors.primary : "#fff",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
        }}
      >
        {checked ? <Text style={{ color: "#fff", fontWeight: "900", fontSize: 13 }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13 }}>{title}</Text>
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4, lineHeight: 17 }}>{text}</Text>
      </View>
    </Pressable>
  );
}

export function LocationConsentCard({
  consent,
  signal,
  onAccept,
  busy = false,
  testID = "loc-consent",
}: {
  consent?: LocationConsent | null;
  signal?: LocationSignal | null;
  onAccept: (payload: { accept_kvkk: true; accept_share: true }) => void | Promise<void>;
  busy?: boolean;
  testID?: string;
}) {
  const view = normalizeLocationConsent(consent);
  const accepted = locationConsentAccepted(view);
  const [kvkk, setKvkk] = useState(view.accept_kvkk);
  const [share, setShare] = useState(view.accept_share);
  const [err, setErr] = useState<string | null>(null);

  if (accepted) {
    return (
      <Card testID={`${testID}-ok`}>
        <Muted>K / KK sözleşmeleri kabul edildi</Muted>
        <LocationSignalDot signal={signal} testID={`${testID}-signal`} />
      </Card>
    );
  }

  const submit = async () => {
    const invalid = validateLocationConsent({ accept_kvkk: kvkk, accept_share: share });
    if (invalid) { setErr(invalid); return; }
    setErr(null);
    await onAccept({ accept_kvkk: true, accept_share: true });
  };

  return (
    <Card testID={testID} style={{ borderColor: "#F59E0B", backgroundColor: colors.amber50 }}>
      <Text style={{ fontWeight: "800", color: colors.text, fontSize: 15 }}>Konum paylaşımı sözleşmeleri</Text>
      <Text testID={`${testID}-warning`} style={{ color: "#92400E", fontWeight: "700", fontSize: 12, marginTop: 6 }}>
        {view.warning}
      </Text>
      <View style={{ gap: 12, marginTop: 12 }}>
        <CheckRow
          testID={`${testID}-kvkk`}
          checked={kvkk}
          onToggle={() => setKvkk((v) => !v)}
          title={view.kvkk_title}
          text={view.kvkk_text}
        />
        <CheckRow
          testID={`${testID}-kk`}
          checked={share}
          onToggle={() => setShare((v) => !v)}
          title={view.share_title}
          text={view.share_text}
        />
      </View>
      {err ? <Text testID={`${testID}-error`} style={{ color: colors.danger, fontWeight: "700", fontSize: 12 }}>{err}</Text> : null}
      <PrimaryButton
        title={busy ? "Kaydediliyor…" : "Kabul et ve paneli aç"}
        onPress={submit}
        disabled={busy || !kvkk || !share}
        color={colors.accent}
        testID={`${testID}-accept`}
      />
    </Card>
  );
}
