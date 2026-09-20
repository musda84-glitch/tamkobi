import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "./chips";
import { ActionTiles, type ActionTile } from "./ActionTiles";
import { Card, Field, Muted, PrimaryButton, Row } from "./kit";
import { colors } from "../theme";
import type { Contact } from "../types";
import { normalizeApiBase } from "../api/url";
import { idOf } from "../utils/money";
import {
  approvalChannelNeedsFallback,
  approvalChannels,
  approvalPayload,
  approvalPublicOrigin,
  approvalSendFeedback,
  approvalStatusTr,
  channelResultLabel,
  contactEmail,
  contactPhone,
  defaultApprovalFlags,
  emailComposerHref,
  mergeApprovalFlags,
  smsComposerHref,
  validateApprovalSend,
} from "../utils/quoteApproval";
import { downloadQuotePdf, printQuoteForm, shareApprovalLink } from "../utils/quoteShare";
import type { QuoteDoc } from "../utils/workDocs";

type SendResult = {
  status?: string;
  link?: string;
  message?: string;
  results?: Record<string, { status?: string; detail?: string; wa_link?: string }>;
};

export function QuoteActions({
  quote,
  contact,
  onSave,
  saveBusy,
  onReloaded,
  onMessage,
  onError,
}: {
  quote: QuoteDoc;
  contact?: Contact | null;
  onSave?: () => void;
  saveBusy?: boolean;
  onReloaded?: () => Promise<void> | void;
  onMessage?: (text: string) => void;
  onError?: (text: string) => void;
}) {
  const { client, activeCompany } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState(true);
  const [phone, setPhone] = useState(contactPhone(contact));
  const [email, setEmail] = useState(contactEmail(contact));
  const [flags, setFlags] = useState(() => defaultApprovalFlags(contactPhone(contact), contactEmail(contact)));
  const [result, setResult] = useState<SendResult | null>(null);

  const applyContact = (row?: Contact | null) => {
    const nextPhone = contactPhone(row);
    const nextEmail = contactEmail(row);
    if (nextPhone) setPhone((cur) => cur.trim() || nextPhone);
    if (nextEmail) setEmail((cur) => cur.trim() || nextEmail);
    if (nextPhone || nextEmail) setFlags((f) => mergeApprovalFlags(f, nextPhone, nextEmail));
  };

  useEffect(() => {
    applyContact(contact);
  }, [contact?.phone, contact?.email, contact?.contact_person_phone]);

  useEffect(() => {
    const cid = quote.contact_id;
    if (!cid || contact) return;
    let cancelled = false;
    get<{ contact?: Contact }>(client, `/contacts/${cid}/overview`)
      .then((ov) => {
        if (!cancelled) applyContact(ov?.contact);
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [client, contact, quote.contact_id]);

  const link = result?.link || quote.approval?.link || "";
  const channelResults = result?.results || quote.approval?.results;
  const statusLabel = approvalStatusTr(quote.approval?.status);

  const fillFromContact = () => {
    applyContact(contact);
  };

  const tiles: ActionTile[] = useMemo(() => [
    {
      key: "print",
      label: "Yazdır",
      icon: "print",
      tone: "slate",
      busy: busy === "print",
      testID: "quote-print",
      onPress: async () => {
        setBusy("print");
        try {
          await printQuoteForm(quote, activeCompany, client);
          onMessage?.("Teklif yazdırmaya gönderildi.");
        } catch (err) {
          onError?.(apiErrorMessage(err, "Yazdırılamadı."));
        } finally {
          setBusy(null);
        }
      },
    },
    {
      key: "pdf",
      label: "PDF İndir",
      icon: "download",
      tone: "indigo",
      busy: busy === "pdf",
      testID: "quote-pdf",
      onPress: async () => {
        setBusy("pdf");
        try {
          const kind = await downloadQuotePdf(client, quote, activeCompany);
          onMessage?.(kind === "file" ? "PDF indirildi." : "PDF için yazdır penceresinden kaydedin.");
        } catch (err) {
          onError?.(apiErrorMessage(err, "PDF indirilemedi."));
        } finally {
          setBusy(null);
        }
      },
    },
    {
      key: "approval",
      label: "Onay iste",
      icon: "send",
      tone: "teal",
      busy: busy === "send",
      testID: "quote-approval",
      onPress: () => {
        fillFromContact();
        setPanel((open) => !open);
      },
    },
  ], [activeCompany, busy, client, contact?.email, contact?.phone, contact?.contact_person_phone, onError, onMessage, quote]);

  const send = async () => {
    const channels = approvalChannels(flags);
    const invalid = validateApprovalSend(channels, phone, email);
    if (invalid) { onError?.(invalid); return; }
    const qid = idOf(quote);
    if (!qid) { onError?.("Teklif kaydı yok."); return; }
    setBusy("send");
    try {
      const origin = approvalPublicOrigin(normalizeApiBase(client.baseUrl), quote.approval?.link);
      const r = await post<SendResult>(client, `/quotes/${qid}/send-approval`, approvalPayload(channels, phone, email, origin));
      setResult(r);
      const body = `Teklif onayı: ${r.link || ""}`;
      const subject = `${quote.quote_number || "Teklif"} onayınızı bekliyor`;
      const opened = { sms: false, email: false };
      if (r.link && approvalChannelNeedsFallback(r.results, channels, "sms")) {
        try {
          await Linking.openURL(smsComposerHref(phone, body));
          opened.sms = true;
        } catch {
          opened.sms = false;
        }
      }
      if (r.link && approvalChannelNeedsFallback(r.results, channels, "email")) {
        try {
          await Linking.openURL(emailComposerHref(email, subject, body));
          opened.email = true;
        } catch {
          opened.email = false;
        }
      }
      const fb = approvalSendFeedback(r.results, channels, opened);
      if (fb.ok) onMessage?.(fb.message);
      else onError?.(fb.message);
      await onReloaded?.();
    } catch (err) {
      onError?.(apiErrorMessage(err, "Onay linki gönderilemedi."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      {onSave ? (
        <PrimaryButton
          title={saveBusy ? "Kaydediliyor…" : "Kaydet"}
          onPress={onSave}
          loading={saveBusy}
          color={colors.primary}
          testID="quote-save"
        />
      ) : null}
      <ActionTiles items={tiles} columns={3} size="sm" />
      {quote.approval ? (
        <Muted testID="quote-approval-status">
          Müşteri onayı: {statusLabel}{quote.approval.responder_name ? ` · ${quote.approval.responder_name}` : ""}{quote.approval.view_count ? ` · ${quote.approval.view_count} görüntüleme` : ""}
        </Muted>
      ) : null}
      {panel ? (
        <Card testID="quote-approval-panel">
          <Muted>MÜŞTERİYE ONAY LİNKİ</Muted>
          <Muted>Müşteri linke tıklayıp onaylar veya reddeder; sonuç teklife işlenir.</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            <Chip label="WhatsApp" active={flags.whatsapp} onPress={() => setFlags((f) => ({ ...f, whatsapp: !f.whatsapp }))} testID="quote-ch-whatsapp" />
            <Chip label="SMS" active={flags.sms} onPress={() => setFlags((f) => ({ ...f, sms: !f.sms }))} testID="quote-ch-sms" />
            <Chip label="E-posta" active={flags.email} onPress={() => setFlags((f) => ({ ...f, email: !f.email }))} testID="quote-ch-email" />
          </Row>
          <Field label="Telefon" testID="quote-approval-phone" value={phone} onChangeText={setPhone} placeholder="05XX…" keyboardType="phone-pad" />
          <Field label="E-posta" testID="quote-approval-email" value={email} onChangeText={setEmail} placeholder="musteri@firma.com" autoCapitalize="none" />
          <PrimaryButton
            title={busy === "send" ? "Gönderiliyor…" : quote.approval?.sent_count ? "Tekrar onay iste" : "Onay iste"}
            onPress={send}
            disabled={!!busy}
            color={colors.primary}
            testID="quote-approval-send"
          />
          {link ? (
            <View style={{ gap: 6 }}>
              <Muted>Onay linki</Muted>
              <Text selectable style={{ color: colors.accent, fontWeight: "700", fontSize: 12 }} testID="quote-approval-link">{link}</Text>
              <Row>
                <Pressable testID="quote-approval-copy" onPress={() => shareApprovalLink(link, quote.quote_number).then(() => onMessage?.("Link kopyalandı / paylaşıldı.")).catch(() => onError?.("Link paylaşılamadı."))}>
                  <Text style={{ fontWeight: "800", color: colors.text }}>Kopyala / paylaş</Text>
                </Pressable>
                <Pressable testID="quote-approval-open" onPress={() => Linking.openURL(link).catch(() => onError?.("Link açılamadı."))}>
                  <Text style={{ fontWeight: "800", color: colors.accent }}>Aç</Text>
                </Pressable>
              </Row>
              {channelResults ? Object.entries(channelResults).map(([k, v]) => (
                <View key={k}>
                  <Muted testID={`quote-approval-result-${k}`}>{k.toUpperCase()} · {channelResultLabel(v.status)}{v.detail ? ` · ${v.detail}` : ""}</Muted>
                  {v.wa_link ? (
                    <Pressable onPress={() => Linking.openURL(v.wa_link!).catch(() => null)}>
                      <Text style={{ color: colors.primary, fontWeight: "700" }}>WhatsApp’ta aç</Text>
                    </Pressable>
                  ) : null}
                </View>
              )) : null}
            </View>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}
