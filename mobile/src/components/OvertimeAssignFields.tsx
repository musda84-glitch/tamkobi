import React from "react";
import { Text, View } from "react-native";
import { colors, radius } from "../theme";
import { hoursFromTimeRange, hoursToHm } from "../utils/overtimeRange";
import { DateField } from "./DateField";
import { TimeField } from "./TimeField";
import { Field, Muted } from "./kit";

export type OvertimeAssignValue = {
  date: string;
  start: string;
  end: string;
  hours: string;
  note: string;
};

/** Web AssignOvertimeModal: takvim + 18:00–20:30 aralığı, süre otomatik. */
export function OvertimeAssignFields({
  value,
  onChange,
}: {
  value: OvertimeAssignValue;
  onChange: (next: OvertimeAssignValue) => void;
}) {
  const set = (patch: Partial<OvertimeAssignValue>) => onChange({ ...value, ...patch });
  const setRange = (start: string, end: string) => {
    const hrs = hoursFromTimeRange(start, end);
    set({ start, end, hours: hrs != null ? String(hrs) : value.hours });
  };
  const ranged = hoursFromTimeRange(value.start, value.end);

  return (
    <View testID="ot-range-fields">
      <Muted>Saat aralığı girin (örn. 18:00–20:30). Süre otomatik hesaplanır; beklenen çıkış bu aralığa göre uzar.</Muted>
      <DateField label="Tarih" testID="ot-date-input" value={value.date} onChangeText={(date) => set({ date })} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <TimeField
            label="Başlangıç saati"
            testID="ot-start-input"
            value={value.start}
            onChangeText={(start) => setRange(start, value.end)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TimeField
            label="Bitiş saati"
            testID="ot-end-input"
            value={value.end}
            onChangeText={(end) => setRange(value.start, end)}
          />
        </View>
      </View>
      <View
        testID="ot-range-hint"
        style={{
          marginBottom: 12,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: "#C7D2FE",
          backgroundColor: "#EEF2FF",
        }}
      >
        <Text style={{ color: "#3730A3", fontSize: 12, fontWeight: "700" }}>
          {ranged != null
            ? `Aralık ${value.start} – ${value.end} · ${ranged} sa`
            : "Saat aralığı: başlangıç ve bitiş seçin, örn. 18:00 – 20:30"}
        </Text>
      </View>
      <TimeField
        label="Toplam saat"
        testID="ot-hours-input"
        value={hoursToHm(value.hours)}
        onChangeText={(v) => {
          const hrs = hoursFromTimeRange("00:00", v);
          set({ hours: hrs != null ? String(hrs) : v });
        }}
      />
      <Field label="Not" testID="ot-note-input" value={value.note} onChangeText={(note) => set({ note })} placeholder="Opsiyonel" />
    </View>
  );
}
