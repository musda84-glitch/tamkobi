import React from "react";
import { Text, View } from "react-native";
import { radius } from "../theme";
import { DateField } from "./DateField";
import { Field, Muted } from "./kit";

export type OvertimeAssignValue = {
  date: string;
  start: string;
  end: string;
  hours: string;
  note: string;
};

/** Mesai bitişinden sonra eklenecek süre (saat). Örn. 2 → beklenen çıkış +2 sa. */
export function OvertimeAssignFields({
  value,
  onChange,
}: {
  value: OvertimeAssignValue;
  onChange: (next: OvertimeAssignValue) => void;
}) {
  const set = (patch: Partial<OvertimeAssignValue>) => onChange({ ...value, ...patch });
  const hrs = Number(String(value.hours || "").replace(",", "."));
  const hasHrs = Number.isFinite(hrs) && hrs > 0;

  return (
    <View testID="ot-range-fields">
      <Muted>
        Mesai bitiminden sonra kaç saat fazla mesai olacağını yazın (örn. 2). Bu süre mesai bitişine eklenir; beklenen çıkış uzar.
      </Muted>
      <DateField label="Tarih" testID="ot-date-input" value={value.date} onChangeText={(date) => set({ date })} />
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
          {hasHrs
            ? `Mesai bitişinden sonra +${hrs} sa`
            : "Örn. 2 yazınca mesai bitişine 2 saat eklenir"}
        </Text>
      </View>
      <Field
        label="Süre (saat)"
        testID="ot-hours-input"
        value={value.hours}
        onChangeText={(hours) => set({ hours, start: "", end: "" })}
        keyboardType="decimal-pad"
        placeholder="Örn: 2"
      />
      <Field label="Not" testID="ot-note-input" value={value.note} onChangeText={(note) => set({ note })} placeholder="Opsiyonel" />
    </View>
  );
}
