import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Contact } from "../types";
import {
  CHEQUE_DIRECTIONS,
  CHEQUE_INSTRUMENTS,
  chequePayload,
  emptyChequeDraft,
  validateChequeDraft,
  type ChequeDraft,
} from "../utils/cheques";
import { idOf, todayIso } from "../utils/money";

export function ChequeFormScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/cheques", "edit");
  const [draft, setDraft] = useState<ChequeDraft>(emptyChequeDraft(todayIso()));
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [custQ, setCustQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ChequeDraft>(key: K, value: ChequeDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const load = useCallback(async () => {
    try {
      const rows = await get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true });
      setContacts(rows || []);
    } catch (err) {
      setError(apiErrorMessage(err, "Cari listesi yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  const hits = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (s.length < 2) return [];
    return contacts
      .filter((c) => [c.name, c.phone, c.tax_number_or_id, c.city].some((v) => String(v || "").toLowerCase().includes(s)))
      .slice(0, 8);
  }, [contacts, custQ]);

  const save = async () => {
    const invalid = validateChequeDraft(draft);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Çek / senet kaydı yetkiniz yok."); return; }
    setBusy(true);
    try {
      await post(client, "/cheques", chequePayload(draft, companyId));
      router.back();
    } catch (err) {
      setError(apiErrorMessage(err, "Çek / senet kaydedilemedi."));
      setBusy(false);
    }
  };

  const kind = draft.instrument === "promissory" ? "Senet" : "Çek";

  return (
    <Screen>
      <H1>Yeni çek / senet</H1>
      <Muted>Kayıt cari bakiyesine işlenir; portföyde “açık” olarak başlar.</Muted>
      <ErrorBanner message={error} />

      <Muted>Yön</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {CHEQUE_DIRECTIONS.map((d) => (
          <Chip key={d.key} label={d.label} active={draft.direction === d.key} testID={`cheque-direction-${d.key}`} onPress={() => set("direction", d.key)} />
        ))}
      </Row>
      <Muted>Tür</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {CHEQUE_INSTRUMENTS.map((i) => (
          <Chip key={i.key} label={i.label} active={draft.instrument === i.key} testID={`cheque-instrument-${i.key}`} onPress={() => set("instrument", i.key)} />
        ))}
      </Row>

      <Card>
        <Muted>Cari</Muted>
        {draft.contact_id ? (
          <ListRow
            testID="cheque-contact-selected"
            title={draft.contact_name || "Cari"}
            subtitle="Değiştirmek için dokunun"
            onPress={() => setDraft((d) => ({ ...d, contact_id: "", contact_name: "" }))}
          />
        ) : (
          <>
            <Field label="Cari ara" testID="cheque-contact-search" value={custQ} onChangeText={setCustQ} placeholder="Ad / VKN / telefon" />
            {hits.map((c) => (
              <ListRow
                key={idOf(c)}
                testID={`cheque-contact-${idOf(c)}`}
                title={c.name}
                subtitle={[c.city, c.phone].filter(Boolean).join(" · ")}
                onPress={() => { setDraft((d) => ({ ...d, contact_id: idOf(c), contact_name: c.name })); setCustQ(""); }}
              />
            ))}
          </>
        )}
      </Card>

      <Field label="Tutar (₺)" testID="cheque-amount" value={draft.amount} onChangeText={(v) => set("amount", v)} keyboardType="decimal-pad" />
      <Field label={`${kind} no`} testID="cheque-serial" value={draft.serial_no} onChangeText={(v) => set("serial_no", v)} autoCapitalize="characters" />
      <Field label="Keşide tarihi" testID="cheque-issue-date" value={draft.issue_date} onChangeText={(v) => set("issue_date", v)} placeholder="YYYY-AA-GG" />
      <Field label="Vade" testID="cheque-due-date" value={draft.due_date} onChangeText={(v) => set("due_date", v)} placeholder="YYYY-AA-GG" />
      {draft.instrument === "cheque" ? (
        <>
          <Field label="Banka" testID="cheque-bank" value={draft.bank_name} onChangeText={(v) => set("bank_name", v)} placeholder="Örn: Garanti BBVA" />
          <Field label="Şube" testID="cheque-branch" value={draft.bank_branch} onChangeText={(v) => set("bank_branch", v)} />
          <Field label="Hesap no" testID="cheque-account-no" value={draft.account_no} onChangeText={(v) => set("account_no", v)} />
        </>
      ) : null}
      <Field label="Keşideci" testID="cheque-drawer" value={draft.drawer_name} onChangeText={(v) => set("drawer_name", v)} placeholder="Boşsa cari adı kullanılır" />
      <Field label="Not" testID="cheque-notes" value={draft.notes} onChangeText={(v) => set("notes", v)} multiline />

      <PrimaryButton title={busy ? "Kaydediliyor…" : "Kaydet"} onPress={save} loading={busy} disabled={!canEdit} color={colors.primary} testID="cheque-save" />
    </Screen>
  );
}
