import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "./chips";
import { ActionTiles, type ActionTile } from "./ActionTiles";
import { Card, Field, Muted, PrimaryButton, Row } from "./kit";
import { colors } from "../theme";
import type { Contact } from "../types";
import { normalizeApiBase } from "../api/url";
import { idOf } from "../utils/money";
import {
  approvalChannels,
  approvalPayload,
  approvalStatusTr,
  defaultApprovalFlags,
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
  onReloaded,
  onMessage,
  onError,
}: {
  quote: QuoteDoc;
  contact?: Contact | null;
  onReloaded?: () => Promise<void> | void;
  onMessage?: (text: string) => void;
  onError?: (text: string) => void;
}) {
  const { client, activeCompany } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const [phone, setPhone] = useState(contact?.phone || "");
  const [email, setEmail] = useState(contact?.email || "");
  const [flags, setFlags] = useState(() => defaultApprovalFlags(contact?.phone, contact?.email));
  const [result, setResult] = useState<SendResult | null>(null);

  const link = result?.link || quote.approval?.link || "";
  const statusLabel = approvalStatusTr(quote.approval?.status);

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
          await printQuoteForm(quote, activeCompany);
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
      label: "PDF indir",
      icon: "download",
      tone: "indigo",
      busy: busy === "pdf",
      testID: "quote-pdf",
      onPress: async () => {
        setBusy("pdf");
        try {
          const kind = await downloadQuotePdf(client, quote);
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
      label: quote.approval ? "Onay linki" : "Onaya gönder",
      icon: "send",
      tone: "teal",
      busy: busy === "send",
      testID: "quote-approval",
      onPress: () => {
        setPhone((p) => p || contact?.phone || "");
        setEmail((e) => e || contact?.email || "");
        setFlags((f) => (f.sms || f.email || f.whatsapp ? f : defaultApprovalFlags(contact?.phone, contact?.email)));
        setPanel((open) => !open);
      },
    },
  ], [activeCompany, busy, client, contact?.email, contact?.phone, onError, onMessage, quote]);

  const send = async () => {
    const channels = approvalChannels(flags);
    const invalid = validateApprovalSend(channels, phone, email);
    if (invalid) { onError?.(invalid); return; }
    const qid = idOf(quote);
    if (!qid) { onError?.("Teklif kaydı yok."); return; }
    setBusy("send");
    try {
      const r = await post<SendResult>(client, `/quotes/${qid}/send-approval`, approvalPayload(channels, phone, email, normalizeApiBase(client.baseUrl)));
      setResult(r);
      onMessage?.(r.message || "Onay linki gönderildi.");
      await onReloaded?.();
    } catch (err) {
      onError?.(apiErrorMessage(err, "Onay linki gönderilemedi."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 10 }}>
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
            title={busy === "send" ? "Gönderiliyor…" : quote.approval?.sent_count ? "Tekrar gönder" : "Onay linki gönder"}
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
              {result?.results ? Object.entries(result.results).map(([k, v]) => (
                <View key={k}>
                  <Muted>{k.toUpperCase()} · {v.status === "sent" ? "Gönderildi" : v.status === "simulated" ? "Simüle" : "Hata"}{v.detail ? ` · ${v.detail}` : ""}</Muted>
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
