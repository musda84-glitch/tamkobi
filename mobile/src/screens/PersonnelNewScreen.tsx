import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text } from "react-native";
import { post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import { fmtMoney, todayIso } from "../utils/money";
import {
  emptyEmployeeDraft,
  employeePayload,
  hasEmployeeDetails,
  validateEmployee,
} from "../utils/personnel";

export function PersonnelNewScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/personnel", "edit");
  const [draft, setDraft] = useState(() => emptyEmployeeDraft(todayIso()));
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const leaveList = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/personnel");
  };

  const save = async () => {
    const invalid = validateEmployee(draft);
    if (invalid) {
      if (invalid.includes("IBAN")) setShowDetails(true);
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await post(client, "/personnel/employees", employeePayload(draft, companyId));
      setError(null);
      router.replace("/personnel");
    } catch (err) {
      setError(apiErrorMessage(err, "Personel kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  if (!canEdit) {
    return (
      <Screen>
        <H1>Yeni personel</H1>
        <Muted>Personel ekleme yetkiniz yok.</Muted>
        <PrimaryButton title="Personel sayfasına dön" onPress={leaveList} testID="personnel-add-back" />
      </Screen>
    );
  }

  return (
    <Screen>
      <H1>Yeni personel</H1>
      <Muted>Kayıt veya vazgeç personel listesine döner. Liste bu sayfada görünmez.</Muted>
      <ErrorBanner message={error} />
      <Card testID="personnel-add-form">
        <Field label="Ad soyad" testID="emp-name" value={draft.full_name} onChangeText={(v) => setDraft({ ...draft, full_name: v })} />
        <Field label="TC kimlik" testID="emp-tc" value={draft.tc_kimlik} onChangeText={(v) => setDraft({ ...draft, tc_kimlik: v })} keyboardType="number-pad" />
        <Field label="Departman" testID="emp-dept" value={draft.department} onChangeText={(v) => setDraft({ ...draft, department: v })} />
        <Field label="Pozisyon" testID="emp-pos" value={draft.position} onChangeText={(v) => setDraft({ ...draft, position: v })} />
        <Field label="Telefon" testID="emp-phone" value={draft.phone} onChangeText={(v) => setDraft({ ...draft, phone: v })} keyboardType="phone-pad" />
        <Field label="E-posta" testID="emp-email" value={draft.email} onChangeText={(v) => setDraft({ ...draft, email: v })} autoCapitalize="none" keyboardType="email-address" />
        <Row>
          {(["monthly", "daily"] as const).map((k) => (
            <Pressable
              key={k}
              testID={k === "monthly" ? "employee-pay-monthly" : "employee-pay-daily"}
              onPress={() => setDraft({ ...draft, pay_type: k })}
              style={{
                flex: 1,
                minHeight: 36,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: draft.pay_type === k ? (k === "daily" ? "#F59E0B" : colors.primary) : colors.border,
                backgroundColor: draft.pay_type === k ? (k === "daily" ? "#F59E0B" : colors.primary) : colors.surface,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 12, color: draft.pay_type === k ? "#fff" : colors.muted }}>
                {k === "monthly" ? "Aylık maaş" : "Günlük yevmiye"}
              </Text>
            </Pressable>
          ))}
        </Row>
        {draft.pay_type === "daily" ? (
          <>
            <Field label="Günlük yevmiye (₺)" testID="emp-daily-wage" value={draft.daily_wage} onChangeText={(v) => setDraft({ ...draft, daily_wage: v })} keyboardType="decimal-pad" />
            <Muted>Bordro = yevmiye × o ay gelen gün. Tahmini ay: {fmtMoney((Number(draft.daily_wage) || 0) * 26)} (26 gün).</Muted>
          </>
        ) : (
          <Field label="Net maaş (₺)" testID="emp-salary" value={draft.salary} onChangeText={(v) => setDraft({ ...draft, salary: v })} keyboardType="decimal-pad" />
        )}
        <Pressable testID="emp-details-toggle" onPress={() => setShowDetails((v) => !v)} style={{ paddingVertical: 6 }}>
          <Text style={{ fontWeight: "700", color: colors.indigo, fontSize: 13 }}>
            {showDetails || hasEmployeeDetails(draft) ? "Ayrıntıları gizle" : "Ayrıntılar"}
            {String(draft.sgk_number || "").trim() ? " · SGK" : ""}
          </Text>
        </Pressable>
        {showDetails ? (
          <>
            <Field label="SGK sicil no" testID="emp-sgk" value={draft.sgk_number} onChangeText={(v) => setDraft({ ...draft, sgk_number: v.replace(/\D/g, "").slice(0, 13) })} keyboardType="number-pad" />
            <Field label={String(draft.sgk_number || "").trim() ? "IBAN (zorunlu)" : "IBAN"} testID="emp-iban" value={draft.iban} onChangeText={(v) => setDraft({ ...draft, iban: v })} autoCapitalize="characters" />
            <Field label="Yemek ücreti (aylık ₺)" testID="emp-meal" value={draft.meal_allowance} onChangeText={(v) => setDraft({ ...draft, meal_allowance: v })} keyboardType="decimal-pad" />
            <Field label="Yol ödemesi (aylık ₺)" testID="emp-transport" value={draft.transport_allowance} onChangeText={(v) => setDraft({ ...draft, transport_allowance: v })} keyboardType="decimal-pad" />
            <Field label="Doğum tarihi" testID="emp-birth" value={draft.birth_date} onChangeText={(v) => setDraft({ ...draft, birth_date: v })} placeholder="YYYY-AA-GG" />
            <Field label="Acil durum iletişim" testID="emp-emergency" value={draft.emergency_contact} onChangeText={(v) => setDraft({ ...draft, emergency_contact: v })} />
            <Field label="Adres" testID="emp-address" value={draft.address} onChangeText={(v) => setDraft({ ...draft, address: v })} />
            <Field label="Notlar" testID="emp-notes" value={draft.notes} onChangeText={(v) => setDraft({ ...draft, notes: v })} />
            <Field label="İşe başlama" testID="emp-start" value={draft.start_date} onChangeText={(v) => setDraft({ ...draft, start_date: v })} placeholder="YYYY-AA-GG" />
          </>
        ) : (
          <Field label="İşe başlama" testID="emp-start" value={draft.start_date} onChangeText={(v) => setDraft({ ...draft, start_date: v })} placeholder="YYYY-AA-GG" />
        )}
        <PrimaryButton title="Kaydet" onPress={save} loading={busy} color={colors.primary} testID="personnel-add-save" />
        <PrimaryButton title="Vazgeç" onPress={leaveList} testID="personnel-add-cancel" />
      </Card>
    </Screen>
  );
}
