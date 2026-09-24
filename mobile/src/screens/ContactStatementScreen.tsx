import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Share, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { Card, ErrorBanner, H1, ListRow, Muted, Screen } from "../components/kit";
import { colors } from "../theme";
import { printHtmlNative } from "../utils/nativePrint";
import { openPrintHtml, printDocumentHtml } from "../utils/orderPrint";
import { enrichPrintCompany } from "../utils/orderShare";
import {
  buildStatementRows,
  smsBalanceText,
  statementPrintHtml,
  statementText,
  waDigits,
  type StatementCheque,
  type StatementRow,
} from "../utils/contactStatement";
import { CONTACT_STATEMENT_MENU_ITEMS, type StatementMenuItem } from "../utils/contactStatementMenu";
import { fmtMoney } from "../utils/money";

export function ContactStatementScreen() {
  const { client, companyId, activeCompany } = useAuth();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const rowsFor = (includeCheques: boolean, cheques?: StatementCheque[]): StatementRow[] =>
    buildStatementRows({ ...(data || {}), cheques: cheques || data?.cheques || [] }, { includeCheques });

  const printRows = async (printRowsList: StatementRow[], variant: "statement" | "detailed" | "reconciliation") => {
    const title = variant === "reconciliation"
      ? `Cari Mutabakat - ${contact.name || name || "Cari"}`
      : variant === "detailed"
        ? `Detaylı Ekstre - ${contact.name || name || "Cari"}`
        : `Cari Hesap Ekstresi - ${contact.name || name || "Cari"}`;
    const printCompany = await enrichPrintCompany(client, activeCompany);
    const body = statementPrintHtml(
      {
        name: contact.name || name,
        tax_number_or_id: contact.tax_number_or_id,
        tax_office: contact.tax_office,
        address: contact.address,
        city: contact.city,
        balance: contact.balance,
      },
      printRowsList,
      printCompany || activeCompany,
      { variant },
    );
    if (Platform.OS === "web" && openPrintHtml(title, body, { page: "a4" })) {
      setMessage(variant === "reconciliation" ? "Mutabakat yazdırmaya gönderildi." : "Ekstre yazdırmaya gönderildi.");
      return;
    }
    const document = printDocumentHtml(title, body, "a4");
    if (await printHtmlNative(document)) {
      setMessage(variant === "reconciliation" ? "Mutabakat yazdırmaya gönderildi." : "Ekstre yazdırmaya gönderildi.");
      return;
    }
    const shareText = statementText({ name: contact.name || name, balance: contact.balance }, printRowsList, activeCompany?.name);
    await Share.share({ message: shareText, title });
    setMessage("Yazdırma yok; metin paylaşıldı.");
  };

  const loadCheques = async (): Promise<StatementCheque[]> => {
    if (Array.isArray(data?.cheques) && data.cheques.length) return data.cheques;
    try {
      const ov = await get<{ cheques?: StatementCheque[] }>(client, `/contacts/${id}/overview`);
      return ov?.cheques || [];
    } catch {
      return [];
    }
  };

  const runMenu = async (item: StatementMenuItem) => {
    setMenuOpen(false);
    setBusy(true);
    setError(null);
    try {
      if (item.action === "link") {
        const r = await post<{ link?: string; pdf_url?: string }>(client, `/contacts/${id}/statement-link`, {
          base_url: client.baseUrl,
        });
        const link = String(r.link || "").trim();
        if (!link) throw new Error("Ekstre linki oluşturulamadı.");
        const note = `Sayın ${contact.name || name || "Cari"}, cari hesap ekstreniz:\n${link}${r.pdf_url ? `\nPDF: ${r.pdf_url}` : ""}`;
        if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(link).catch(() => null);
        }
        await Share.share({ message: note, url: link, title: "Ekstre linki" }).catch(() => null);
        setMessage(`Ekstre linki: ${link}`);
        return;
      }
      const includeCheques = item.action === "detailed";
      const cheques = includeCheques ? await loadCheques() : [];
      const nextRows = rowsFor(includeCheques, cheques);
      await printRows(nextRows, item.action === "reconciliation" ? "reconciliation" : item.action === "detailed" ? "detailed" : "statement");
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem yapılamadı."));
    } finally {
      setBusy(false);
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
    const printCompany = await enrichPrintCompany(client, activeCompany);
    const body = statementPrintHtml(
      {
        name: contact.name || name,
        tax_number_or_id: contact.tax_number_or_id,
        tax_office: contact.tax_office,
        address: contact.address,
        city: contact.city,
        balance: contact.balance,
      },
      rows,
      printCompany || activeCompany,
    );
    try {
      if (Platform.OS === "web" && openPrintHtml(title, body, { page: "a4" })) {
        setMessage("Ekstre yazdırmaya gönderildi.");
        setError(null);
        return;
      }
      const document = printDocumentHtml(title, body, "a4");
      if (await printHtmlNative(document)) {
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
          { key: "share", label: "Paylaş", icon: "share-social", tone: "emerald", testID: "statement-share", busy, onPress: () => setMenuOpen(true) },
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

      <B2BSheet
        visible={menuOpen}
        title="Hesap Ekstresi"
        subtitle={contact.name || name}
        onClose={() => setMenuOpen(false)}
        testID="statement-share-menu"
      >
        {CONTACT_STATEMENT_MENU_ITEMS.map((item) => (
          <Pressable
            key={item.id}
            testID={`statement-share-${item.id}`}
            onPress={() => runMenu(item)}
            disabled={busy}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 11,
              paddingHorizontal: 8,
              borderRadius: 10,
              backgroundColor: pressed ? colors.slate50 : "transparent",
              opacity: busy ? 0.5 : 1,
            })}
          >
            <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={18} color={item.color} />
            <Text style={{ flex: 1, fontWeight: "600", fontSize: 13, color: colors.text }}>{item.label}</Text>
            {item.badge ? (
              <View style={{ backgroundColor: "#E11D48", borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>{item.badge.toLocaleUpperCase("tr-TR")}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </B2BSheet>
    </Screen>
  );
}
