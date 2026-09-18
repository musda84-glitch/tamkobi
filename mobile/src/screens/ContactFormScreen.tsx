import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, confirmAction } from "../components/chips";
import { Card, ErrorBanner, Field, H1, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import {
  CONTACT_CURRENCIES,
  CONTACT_FORM_TABS,
  CONTACT_PAY_METHODS,
  CONTACT_RISK,
  CONTACT_TYPES,
  contactPayload,
  draftFromContact,
  emptyContactDraft,
  validateContactDraft,
  type ContactDraft,
} from "../utils/contactDraft";
import { idOf } from "../utils/money";

function Flag({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!value)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: value ? colors.emerald50 : colors.slate50,
        flex: 1,
        minWidth: "45%",
      }}
    >
      <Ionicons name={value ? "checkbox" : "square-outline"} size={20} color={value ? colors.primary : colors.muted} />
      <Text style={{ fontWeight: "700", color: colors.text, flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

export function ContactFormScreen({ contactId }: { contactId?: string }) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/contacts", "edit");
  const isNew = !contactId;
  const [tab, setTab] = useState<(typeof CONTACT_FORM_TABS)[number]["key"]>("general");
  const [draft, setDraft] = useState<ContactDraft>(emptyContactDraft());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  const set = <K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const ov = await get<{ contact?: Record<string, unknown> }>(client, `/contacts/${contactId}/overview`);
      setDraft(draftFromContact((ov?.contact || ov || {}) as Record<string, unknown>));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Cari yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [client, contactId]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const invalid = validateContactDraft(draft);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Cari düzenleme yetkiniz yok."); return; }
    setBusy(true);
    setMessage(null);
    try {
      const payload = contactPayload(draft, isNew ? companyId : undefined);
      let saved: { id?: string; _id?: string } = {};
      if (isNew) {
        saved = await post(client, "/contacts", payload);
        setMessage("Cari kartı oluşturuldu.");
      } else {
        saved = await put(client, `/contacts/${contactId}`, payload);
        setMessage("Cari bilgileri güncellendi.");
      }
      const id = idOf(saved) || contactId;
      if (draft.b2b_enabled && id && (draft.b2b_password || draft.b2b_login_email)) {
        await post(client, `/contacts/${id}/b2b-access`, {
          enabled: true,
          discount: Number(draft.b2b_discount) || 0,
          password: draft.b2b_password || undefined,
          login_email: draft.b2b_login_email || undefined,
        }).catch(() => null);
      }
      setError(null);
      if (isNew) router.replace({ pathname: "/contacts/[id]", params: { id: String(id), name: draft.name } });
    } catch (err) {
      setError(apiErrorMessage(err, "Cari kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!contactId || !canEdit) return;
    confirmAction("Cariyi sil", `${draft.name || "Bu cari"} çöp kutusuna taşınsın mı?`, async () => {
      setBusy(true);
      try {
        await del(client, `/contacts/${contactId}`);
        router.replace("/contacts");
      } catch (err) {
        setError(apiErrorMessage(err, "Cari silinemedi."));
        setBusy(false);
      }
    });
  };

  if (loading) return <Screen><Muted>Yükleniyor…</Muted></Screen>;

  return (
    <Screen>
      <H1>{isNew ? "Yeni cari kartı" : "Cariyi düzenle"}</H1>
      <Muted>Web’deki cari formu — genel, vergi, adres, finans, B2B.</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      <Row style={{ flexWrap: "wrap" }}>
        {CONTACT_FORM_TABS.map((t) => (
          <Chip key={t.key} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} testID={`cf-tab-${t.key}`} />
        ))}
      </Row>
      {tab === "general" ? (
        <Card>
          <Row style={{ flexWrap: "wrap" }}>
            {CONTACT_TYPES.map((t) => (
              <Chip key={t.key} label={t.label} active={draft.type === t.key} onPress={() => set("type", t.key)} testID={`cf-type-${t.key}`} />
            ))}
          </Row>
          <Field label="Cari adı *" testID="cf-name" value={draft.name} onChangeText={(v) => set("name", v)} />
          <Field label="Ticari ünvan" testID="cf-company_title" value={draft.company_title} onChangeText={(v) => set("company_title", v)} />
          <Field label="Kategori" testID="cf-category" value={draft.category} onChangeText={(v) => set("category", v)} />
          <Field label="Yetkili kişi" testID="cf-contact_person" value={draft.contact_person} onChangeText={(v) => set("contact_person", v)} />
          <Field label="Yetkili telefon" testID="cf-contact_person_phone" value={draft.contact_person_phone} onChangeText={(v) => set("contact_person_phone", v)} keyboardType="phone-pad" />
          <Field label="Telefon" testID="cf-phone" value={draft.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" />
          <Field label="E-posta" testID="cf-email" value={draft.email} onChangeText={(v) => set("email", v)} autoCapitalize="none" />
          <Field label="Web sitesi" testID="cf-website" value={draft.website} onChangeText={(v) => set("website", v)} autoCapitalize="none" />
          <Field label="Satış temsilcisi" testID="cf-sales_rep" value={draft.sales_rep} onChangeText={(v) => set("sales_rep", v)} />
          <Row style={{ flexWrap: "wrap" }}>
            <Flag label="SMS bildirimi" value={draft.sms_opt_in} onChange={(v) => set("sms_opt_in", v)} testID="cf-sms_opt_in" />
            <Flag label="E-posta bildirimi" value={draft.email_opt_in} onChange={(v) => set("email_opt_in", v)} testID="cf-email_opt_in" />
          </Row>
        </Card>
      ) : null}
      {tab === "tax" ? (
        <Card>
          <Field label="VKN / TCKN *" testID="cf-tax_number_or_id" value={draft.tax_number_or_id} onChangeText={(v) => set("tax_number_or_id", v)} keyboardType="number-pad" />
          <Field label="Vergi dairesi" testID="cf-tax_office" value={draft.tax_office} onChangeText={(v) => set("tax_office", v)} />
          <Flag label="e-Fatura mükellefi" value={draft.is_e_invoice_user} onChange={(v) => set("is_e_invoice_user", v)} testID="cf-is_e_invoice_user" />
          <Muted>Para birimi</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            {CONTACT_CURRENCIES.map((c) => (
              <Chip key={c} label={c} active={draft.currency === c} onPress={() => set("currency", c)} testID={`cf-currency-${c}`} />
            ))}
          </Row>
          <Muted>Ödeme şekli</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            {CONTACT_PAY_METHODS.map((p) => (
              <Chip key={p.key || "none"} label={p.label} active={draft.payment_method === p.key} onPress={() => set("payment_method", p.key)} testID={`cf-pay-${p.key || "none"}`} />
            ))}
          </Row>
        </Card>
      ) : null}
      {tab === "address" ? (
        <Card>
          <Field label="Adres" testID="cf-address" value={draft.address} onChangeText={(v) => set("address", v)} multiline />
          <Field label="İl" testID="cf-city" value={draft.city} onChangeText={(v) => set("city", v)} />
          <Field label="İlçe" testID="cf-district" value={draft.district} onChangeText={(v) => set("district", v)} />
          <Field label="Harita / konum linki" testID="cf-location_url" value={draft.location_url} onChangeText={(v) => set("location_url", v)} autoCapitalize="none" />
        </Card>
      ) : null}
      {tab === "finance" ? (
        <Card>
          <Field label="Kredi / risk limiti (₺)" testID="cf-credit_limit" value={draft.credit_limit} onChangeText={(v) => set("credit_limit", v)} keyboardType="decimal-pad" />
          <Field label="Vade (gün)" testID="cf-payment_term_days" value={draft.payment_term_days} onChangeText={(v) => set("payment_term_days", v)} keyboardType="number-pad" />
          <Field label="Gecikme faizi (% / ay)" testID="cf-late_fee_rate" value={draft.late_fee_rate} onChangeText={(v) => set("late_fee_rate", v)} keyboardType="decimal-pad" />
          <Field label="Varsayılan iskonto (%)" testID="cf-default_discount" value={draft.default_discount} onChangeText={(v) => set("default_discount", v)} keyboardType="decimal-pad" />
          <Muted>Risk</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            {CONTACT_RISK.map((r) => (
              <Chip key={r.key} label={r.label} active={draft.risk_status === r.key} onPress={() => set("risk_status", r.key)} testID={`cf-risk-${r.key}`} />
            ))}
          </Row>
          <Field label="Banka" testID="cf-bank_name" value={draft.bank_name} onChangeText={(v) => set("bank_name", v)} />
          <Field label="IBAN" testID="cf-iban" value={draft.iban} onChangeText={(v) => set("iban", v)} autoCapitalize="characters" />
        </Card>
      ) : null}
      {tab === "b2b" ? (
        <Card>
          <Flag label="B2B sipariş portalı açık" value={draft.b2b_enabled} onChange={(v) => set("b2b_enabled", v)} testID="cf-b2b_enabled" />
          <Field label="B2B iskonto (%)" testID="cf-b2b_discount" value={draft.b2b_discount} onChangeText={(v) => set("b2b_discount", v)} keyboardType="decimal-pad" />
          <Field label="Portal giriş e-postası" testID="cf-b2b_login_email" value={draft.b2b_login_email} onChangeText={(v) => set("b2b_login_email", v)} autoCapitalize="none" />
          <Field label="Portal şifresi" testID="cf-b2b_password" value={draft.b2b_password} onChangeText={(v) => set("b2b_password", v)} secureTextEntry placeholder={isNew ? "min 6" : "değiştirmek için yazın"} />
        </Card>
      ) : null}
      {tab === "notes" ? (
        <Card>
          <Field label="Etiketler (virgülle)" testID="cf-tags" value={draft.tags} onChangeText={(v) => set("tags", v)} />
          <Field label="Notlar" testID="cf-notes" value={draft.notes} onChangeText={(v) => set("notes", v)} multiline />
        </Card>
      ) : null}
      {canEdit ? <PrimaryButton title={isNew ? "Kaydet" : "Güncelle"} onPress={save} loading={busy} color={colors.primary} testID="cf-save" /> : null}
      {!isNew && canEdit ? (
        <Pressable onPress={remove} testID="cf-delete" style={{ alignItems: "center", padding: 12 }}>
          <Text style={{ color: "#BE123C", fontWeight: "800" }}>Cariyi sil</Text>
        </Pressable>
      ) : null}
      <View />
    </Screen>
  );
}
