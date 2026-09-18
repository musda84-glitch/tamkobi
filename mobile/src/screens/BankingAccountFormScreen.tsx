import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { ErrorBanner, Field, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import {
  ACCOUNT_TYPES,
  accountPayload,
  accountUpdatePayload,
  draftFromAccount,
  emptyAccountDraft,
  validateAccountDraft,
  type AccountDraft,
  type BankAccount,
} from "../utils/finance";

export function BankingAccountFormScreen({ accountId }: { accountId?: string }) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const isNew = !accountId;
  const [draft, setDraft] = useState<AccountDraft>(emptyAccountDraft());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof AccountDraft>(key: K, value: AccountDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const load = useCallback(async () => {
    if (!accountId) return;
    try {
      const rows = await get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId });
      const acc = (rows || []).find((a) => String(a.id || a._id) === accountId);
      if (!acc) { setError("Hesap bulunamadı."); return; }
      setDraft(draftFromAccount(acc));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Hesap yüklenemedi."));
    }
  }, [accountId, client, companyId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const invalid = validateAccountDraft(draft);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Hesap düzenleme yetkiniz yok."); return; }
    setBusy(true);
    try {
      if (isNew) {
        const created = await post<BankAccount>(client, "/banking/accounts", accountPayload(draft, companyId));
        router.replace({ pathname: "/banking/[id]", params: { id: String(created.id || created._id || "") } });
      } else {
        await put(client, `/banking/accounts/${accountId}`, accountUpdatePayload(draft));
        router.back();
      }
    } catch (err) {
      setError(apiErrorMessage(err, "Hesap kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>{isNew ? "Yeni hesap" : "Hesabı düzenle"}</H1>
      <Muted>Banka, kasa, POS veya kredi kartı.</Muted>
      <ErrorBanner message={error} />
      <Muted>Tür</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {ACCOUNT_TYPES.map((t) => (
          <Chip key={t.key} label={t.label} active={draft.type === t.key} testID={`bank-type-${t.key}`} onPress={() => canEdit && set("type", t.key)} />
        ))}
      </Row>
      {draft.type !== "cash_box" && draft.type !== "credit_card" ? (
        <Field label="Banka adı" testID="bank-bank-name" value={draft.bank_name} onChangeText={(v) => set("bank_name", v)} editable={canEdit} />
      ) : null}
      <Field label="Hesap adı" testID="bank-account-name" value={draft.account_name} onChangeText={(v) => set("account_name", v)} editable={canEdit} />
      {draft.type === "credit_card" ? (
        <>
          <Field label="Kart sahibi" testID="bank-card-holder" value={draft.card_holder} onChangeText={(v) => set("card_holder", v)} editable={canEdit} />
          <Field label="Son 4 hane" testID="bank-card-last4" value={draft.card_last4} onChangeText={(v) => set("card_last4", v)} keyboardType="number-pad" editable={canEdit} />
          <Field label="SKT (AA/YY)" testID="bank-card-expiry" value={draft.card_expiry} onChangeText={(v) => set("card_expiry", v)} editable={canEdit} />
          <Field label="Kart limiti" testID="bank-card-limit" value={draft.card_limit} onChangeText={(v) => set("card_limit", v)} keyboardType="decimal-pad" editable={canEdit} />
        </>
      ) : (
        <>
          <Field label="IBAN" testID="bank-iban" value={draft.iban} onChangeText={(v) => set("iban", v)} autoCapitalize="characters" editable={canEdit} />
          <Field label="Hesap no" testID="bank-account-no" value={draft.account_number} onChangeText={(v) => set("account_number", v)} editable={canEdit} />
        </>
      )}
      {draft.type === "pos" || draft.type === "okc_pos" ? (
        <Field label="POS komisyon (%)" testID="bank-pos-rate" value={draft.pos_commission_rate} onChangeText={(v) => set("pos_commission_rate", v)} keyboardType="decimal-pad" editable={canEdit} />
      ) : null}
      {draft.type === "okc_pos" ? (
        <>
          <Field label="ÖKC marka" testID="bank-okc-brand" value={draft.okc_brand} onChangeText={(v) => set("okc_brand", v)} editable={canEdit} />
          <Field label="ÖKC seri no" testID="bank-okc-serial" value={draft.okc_serial} onChangeText={(v) => set("okc_serial", v)} editable={canEdit} />
          <Field label="ÖKC terminal id" testID="bank-okc-terminal" value={draft.okc_terminal_id} onChangeText={(v) => set("okc_terminal_id", v)} editable={canEdit} />
        </>
      ) : null}
      {isNew ? (
        <Field label={draft.type === "credit_card" ? "Borç bakiyesi" : "Açılış bakiyesi"} testID="bank-balance" value={draft.current_balance} onChangeText={(v) => set("current_balance", v)} keyboardType="decimal-pad" editable={canEdit} />
      ) : (
        <Text style={{ color: colors.muted }}>Hareketi olan hesabın bakiyesi buradan değişmez.</Text>
      )}
      <PrimaryButton title={busy ? "Kaydediliyor…" : "Kaydet"} onPress={save} loading={busy} disabled={!canEdit} color={colors.primary} testID="bank-save" />
    </Screen>
  );
}

export function BankingAccountFormRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <BankingAccountFormScreen accountId={id} />;
}
