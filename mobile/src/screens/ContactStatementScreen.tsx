import { useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { Card, ErrorBanner, H1, ListRow, Muted, Screen } from "../components/kit";
import { colors } from "../theme";
import { A4_PRINT_PX, printHtmlNative } from "../utils/nativePrint";
import { openPrintHtml, printDocumentHtml } from "../utils/orderPrint";
import { buildStatementRows, smsBalanceText, statementPrintHtml, statementText, waDigits } from "../utils/contactStatement";
import { fmtMoney } from "../utils/money";

export function ContactStatementScreen() {
  const { client, companyId, activeCompany } = useAuth();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const st = await get<any>(client, `/contacts/${id}/statement`);
      setData(st);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Ekstre yüklenemedi."));
    }
  }, [client, id]);

  useEffect(() => { load(); }, [load]);

  const contact = data?.contact || {};
  const rows = useMemo(() => buildStatementRows(data || {}), [data]);
  const text = useMemo(
    () => statementText({ name: contact.name || name, balance: contact.balance }, rows, activeCompany?.name),
    [activeCompany?.name, contact.balance, contact.name, name, rows]
  );
  const last = rows.length ? rows[rows.length - 1].balance : Number(contact.balance) || 0;

  const share = async () => {
    try {
      await Share.share({ message: text });
    } catch {
      setError("Paylaşılamadı.");
    }
  };

  const copy = async () => {
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setMessage("Ekstre metni kopyalandı.");
        return;
      }
      await Share.share({ message: text });
    } catch {
      setError("Kopyalanamadı.");
    }
  };

  const print = async () => {
    const title = `Cari Hesap Ekstresi - ${contact.name || name || "Cari"}`;
    const body = statementPrintHtml(
      { name: contact.name || name, tax_number_or_id: contact.tax_number_or_id, balance: contact.balance },
      rows,
      activeCompany?.name,
    );
    try {
      if (Platform.OS === "web" && openPrintHtml(title, body, { page: "a4" })) {
        setMessage("Ekstre yazdırmaya gönderildi.");
        setError(null);
        return;
      }
      const document = printDocumentHtml(title, body, "a4");
      if (await printHtmlNative(document, A4_PRINT_PX)) {
        setMessage("Ekstre yazdırmaya gönderildi.");
        setError(null);
        return;
      }
      await Share.share({ message: text, title });
      setMessage("Yazdırma yok; ekstre metni paylaşıldı.");
      setError(null);
    } catch {
      setError("Yazdırılamadı.");
    }
  };

  const sendWhatsApp = async () => {
    const phone = waDigits(contact.phone);
    if (!phone) { setError("Carinin telefon numarası yok."); return; }
    Linking.openURL(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`);
    try {
      await post(client, "/comm/whatsapp/logs", {
        company_id: companyId,
        contact_id: id,
        contact_name: contact.name,
        phone: contact.phone,
        message: text,
        direction: "outbound",
      });
    } catch { /* log optional */ }
  };

  return (
    <Screen onRefresh={load}>
      <H1>{contact.name || name || "Cari"} — ekstre</H1>
      <Muted>VKN: {contact.tax_number_or_id || "—"} · Bakiye {fmtMoney(contact.balance)}</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      <ActionTiles
        items={[
          { key: "share", label: "Paylaş", icon: "share-social", tone: "emerald", testID: "statement-share", onPress: share },
          { key: "print", label: "Yazdır", icon: "print", tone: "indigo", testID: "statement-print", onPress: print },
          { key: "whatsapp", label: "WhatsApp", icon: "logo-whatsapp", tone: "emerald", testID: "statement-whatsapp", onPress: sendWhatsApp },
          {
            key: "email",
            label: "E-posta",
            icon: "mail",
            tone: "sky",
            testID: "statement-email",
            onPress: () => {
              if (!contact.email) { setError("Carinin e-postası yok."); return; }
              Linking.openURL(`mailto:${contact.email}?subject=${encodeURIComponent(`Cari Hesap Ekstresi - ${contact.name}`)}&body=${encodeURIComponent(text)}`);
            },
          },
          {
            key: "sms",
            label: "SMS",
            icon: "chatbox",
            tone: "violet",
            testID: "statement-sms",
            onPress: () => {
              const phone = contact.phone;
              if (!phone) { setError("Carinin telefon numarası yok."); return; }
              Linking.openURL(`sms:${phone}?body=${encodeURIComponent(smsBalanceText(contact))}`);
            },
          },
          { key: "copy", label: "Kopyala", icon: "copy", tone: "slate", testID: "statement-copy", onPress: copy },
        ]}
      />
      <Card testID="statement-table">
        <Muted>Hesap hareketleri</Muted>
        {!rows.length ? <Muted>Hareket yok.</Muted> : rows.map((r, idx) => (
          <ListRow
            key={`${r.kind}-${idx}`}
            testID={`statement-row-${r.kind}-${idx}`}
            title={r.doc}
            subtitle={r.date}
            right={`${r.debit ? `B ${fmtMoney(r.debit)}` : `A ${fmtMoney(r.credit)}`}`}
          />
        ))}
        <View style={{ paddingTop: 8 }}>
          <Text style={{ fontWeight: "800", color: last > 0 ? "#BE123C" : colors.primary }}>
            Güncel bakiye {fmtMoney(Math.abs(last))} {last > 0 ? "Borçlu" : last < 0 ? "Alacaklı" : ""}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
