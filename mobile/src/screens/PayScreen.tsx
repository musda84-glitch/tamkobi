import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Contact } from "../types";
import { contactPaymentRequest, paymentTargetGroups, validateContactPayment, type BankAccount, type Partner } from "../utils/finance";
import { fmtMoney, idOf } from "../utils/money";

type PayForm = { type: "inflow" | "outflow"; amount: string; account_id: string; description: string };

export function PayScreen() {
  const { client, companyId, can } = useAuth();
  const canPay = can("/banking", "edit");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Contact | null>(null);
  const [form, setForm] = useState<PayForm>({ type: "inflow", amount: "", account_id: "", description: "Cari tahsilat" });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cts, accs, pars] = await Promise.all([
        get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true }),
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<Partner[]>(client, "/partners", { company_id: companyId }).catch(() => []),
      ]);
      setContacts(cts || []);
      setAccounts(accs || []);
      setPartners((pars || []).filter((p) => p.is_active !== false));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Cariler / hesaplar yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? contacts.filter((c) => [c.name, c.phone, c.tax_number_or_id, c.city].some((v) => String(v || "").toLowerCase().includes(s)))
      : contacts;
    return list.slice(0, 12);
  }, [contacts, q]);

  const groups = useMemo(
    () => paymentTargetGroups(accounts, partners, { collectableOnly: form.type === "inflow" }),
    [accounts, partners, form.type],
  );

  const pick = (c: Contact) => {
    const first = paymentTargetGroups(accounts, partners, { collectableOnly: true })[0]?.options[0]?.value || "";
    setPicked(c);
    setQ("");
    setForm({
      type: "inflow",
      amount: "",
      account_id: first,
      description: "Cari tahsilat",
    });
    setMessage(null);
    setError(null);
  };

  const save = async () => {
    if (!canPay) { setError("Tahsilat yetkiniz yok."); return; }
    if (!picked) { setError("Cari seçin."); return; }
    const invalid = validateContactPayment(form.amount, form.account_id);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      const req = contactPaymentRequest({
        companyId,
        contactId: idOf(picked),
        contactName: picked.name,
        type: form.type,
        amount: n(form.amount),
        accountId: form.account_id,
        description: form.description,
        accounts,
      });
      await post(client, req.path, req.body);
      setMessage(form.type === "inflow" ? "Tahsilat kaydedildi." : "Ödeme kaydedildi.");
      setError(null);
      setPicked(null);
      setForm({ type: "inflow", amount: "", account_id: "", description: "Cari tahsilat" });
    } catch (err) {
      setError(apiErrorMessage(err, "Tahsilat kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen onRefresh={load}>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      {!canPay ? <Muted>Tahsilat / ödeme için kasa yetkisi gerekir.</Muted> : null}

      {picked ? (
        <Card testID="pay-form">
          <Muted>Tahsilat & Ödeme Yap</Muted>
          <ListRow
            testID="pay-picked-contact"
            title={picked.name}
            subtitle={[picked.phone, picked.city].filter(Boolean).join(" · ") || "Değiştirmek için dokunun"}
            onPress={() => setPicked(null)}
          />
          <Row style={{ flexWrap: "wrap" }}>
            <Chip
              label="Tahsilat (müşteriden)"
              active={form.type === "inflow"}
              testID="pay-type-in"
              onPress={() => setForm({ ...form, type: "inflow", description: "Cari tahsilat" })}
            />
            <Chip
              label="Ödeme (cariye)"
              active={form.type === "outflow"}
              testID="pay-type-out"
              color={colors.danger}
              onPress={() => setForm({ ...form, type: "outflow", description: "Cari ödeme" })}
            />
          </Row>
          <GroupedSelect
            label={form.type === "inflow" ? "Kasa / banka / POS / ortak — kredi kartı yok" : "Kasa / banka / kart / ortak"}
            testID="pay-account-select"
            value={form.account_id}
            onChange={(id) => setForm({ ...form, account_id: id })}
            emptyLabel="Hesap seçin"
            groups={groups}
          />
          <Field label="Tutar" testID="pay-amount" value={form.amount} onChangeText={(v) => setForm({ ...form, amount: v })} keyboardType="decimal-pad" />
          <Field label="Açıklama" testID="pay-desc" value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} />
          <PrimaryButton title={busy ? "Kaydediliyor…" : "Kaydet"} onPress={save} loading={busy} color={colors.primary} testID="pay-save" />
          <PrimaryButton title="Vazgeç" onPress={() => setPicked(null)} testID="pay-cancel" />
        </Card>
      ) : (
        <>
          <Muted>Tahsilat veya ödeme için cari seçin.</Muted>
          <Field label="Cari ara" testID="pay-contact-search" value={q} onChangeText={setQ} placeholder="Ad / telefon / VKN" />
          {!hits.length ? (
            <Muted>{q.trim() ? "Cari bulunamadı." : contacts.length ? "Aramaya başlayın veya listeden seçin." : "Cari yok."}</Muted>
          ) : hits.map((c) => (
            <ListRow
              key={idOf(c)}
              testID={`pay-contact-${idOf(c)}`}
              title={c.name}
              subtitle={[c.phone, c.city].filter(Boolean).join(" · ")}
              right={fmtMoney(c.balance)}
              onPress={() => pick(c)}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
