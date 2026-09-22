import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, Text } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, confirmAction, n } from "../components/chips";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Contact } from "../types";
import { accountBalance, accountCashTxRequest, accountTypeTr, normalizeAccountType, txTypeTr, type BankAccount, type BankTx } from "../utils/finance";
import { fmtDate, fmtMoney, idOf, todayIso } from "../utils/money";

export function BankingAccountScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const canExp = can("/expenses", "edit");
  const { id } = useLocalSearchParams<{ id: string }>();
  const [acc, setAcc] = useState<BankAccount | null>(null);
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [txType, setTxType] = useState<"inflow" | "outflow">("inflow");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [contactId, setContactId] = useState("");
  const [custQ, setCustQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [accounts, rows, cnt] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<BankTx[]>(client, "/banking/transactions", { company_id: companyId, account_id: id }),
        get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true }).catch(() => []),
      ]);
      const found = (accounts || []).find((a) => idOf(a) === id) || null;
      setAcc(found);
      setTxs(rows || []);
      setContacts(cnt || []);
      setError(found ? null : "Hesap bulunamadı.");
    } catch (err) {
      setError(apiErrorMessage(err, "Hesap yüklenemedi."));
    }
  }, [client, companyId, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const picked = contacts.find((c) => idOf(c) === contactId);
  const hits = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (s.length < 2) return [];
    return contacts
      .filter((c) => [c.name, c.phone, c.tax_number_or_id, c.company_title].some((v) => String(v || "").toLowerCase().includes(s)))
      .slice(0, 8);
  }, [contacts, custQ]);

  const saveTx = async () => {
    if (!canEdit) { setError("Hareket yetkiniz yok."); return; }
    const amt = n(amount);
    if (!(amt > 0)) { setError("Geçerli bir tutar girin."); return; }
    if (txType === "inflow" && !contactId) { setError("Tahsilat için cari seçin."); return; }
    if (!acc) return;
    setBusy(true);
    try {
      const req = accountCashTxRequest({
        companyId,
        account: acc,
        type: txType,
        amount: amt,
        description: desc.trim(),
        date: todayIso(),
        contactId,
        contactName: picked?.name || "",
      });
      await post(client, req.path, req.body);
      setAmount("");
      setDesc("");
      setContactId("");
      setCustQ("");
      setMessage(txType === "inflow" ? "Tahsilat kaydedildi." : "Tediye kaydedildi.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Hareket kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!canEdit || !acc) return;
    confirmAction("Hesabı sil", `${acc.account_name} silinsin mi?`, () => {
      del(client, `/banking/accounts/${id}`)
        .then(() => router.back())
        .catch((err) => setError(apiErrorMessage(err, "Hesap silinemedi.")));
    });
  };

  if (!acc) return <Screen><ErrorBanner message={error || "Hesap bulunamadı."} /></Screen>;

  const isCard = normalizeAccountType(acc.type) === "credit_card";

  return (
    <Screen onRefresh={load}>
      <H1>{acc.account_name || "Hesap"}</H1>
      <Muted>{[accountTypeTr(acc.type), acc.bank_name, acc.iban].filter(Boolean).join(" · ")}</Muted>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>{fmtMoney(accountBalance(acc), acc.currency)}</Text>
      {acc.is_integrated ? <Muted>Entegre hesap ({acc.integration_provider || "canlı veri"}) — manuel tahsilat kapalı.</Muted> : null}
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      {canEdit ? (
        <PrimaryButton title="Hesabı düzenle" onPress={() => go("BankingEdit", { id })} color={colors.secondary} testID="bank-edit" />
      ) : null}
      {canExp ? (
        <PrimaryButton
          title="Masraf ekle"
          onPress={() => go("ExpenseNew", { account_id: id })}
          color={colors.danger}
          testID="bank-expense-btn"
        />
      ) : null}
      {canEdit && !isCard && !acc.is_integrated ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Tahsilat / tediye</Text>
          <Row>
            <Chip label="Tahsilat" active={txType === "inflow"} testID="bank-tx-in" onPress={() => setTxType("inflow")} />
            <Chip label="Tediye" active={txType === "outflow"} color={colors.danger} testID="bank-tx-out" onPress={() => setTxType("outflow")} />
          </Row>
          {contactId ? (
            <ListRow
              testID="bank-tx-contact"
              title={picked?.name || "Cari"}
              subtitle={txType === "inflow" ? "Tahsilat bu cariye işlenir · değiştir" : "Ödeme bu cariye işlenir · değiştir"}
              onPress={() => { setContactId(""); setCustQ(""); }}
            />
          ) : (
            <>
              <Field
                label={txType === "inflow" ? "Cari ara" : "Cari ara (opsiyonel)"}
                testID="bank-tx-contact-search"
                value={custQ}
                onChangeText={setCustQ}
                placeholder="Ad / telefon / VKN"
              />
              {hits.map((c) => (
                <ListRow
                  key={idOf(c)}
                  testID={`bank-tx-contact-${idOf(c)}`}
                  title={c.name}
                  subtitle={[c.phone, c.tax_number_or_id].filter(Boolean).join(" · ") || "Cari"}
                  onPress={() => { setContactId(idOf(c)); setCustQ(""); }}
                />
              ))}
              {txType === "inflow" ? <Muted>Tahsilat için cari seçin; tutar cari bakiyesine işlenir.</Muted> : null}
            </>
          )}
          <Field label="Tutar" testID="bank-tx-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Açıklama" testID="bank-tx-desc" value={desc} onChangeText={setDesc} />
          <PrimaryButton title={busy ? "Kaydediliyor…" : "Hareketi kaydet"} onPress={saveTx} loading={busy} color={colors.primary} testID="bank-tx-save" />
        </Card>
      ) : isCard ? <Muted>Kredi kartında tahsilat kapalı; masraf veya ekstre kullanın.</Muted> : null}
      <Text style={{ fontWeight: "800", color: colors.text }}>Hareketler</Text>
      {!txs.length ? <Muted>Hareket yok.</Muted> : txs.slice(0, 40).map((tx) => (
        <ListRow
          key={idOf(tx)}
          title={`${txTypeTr(tx.type)} · ${fmtDate(tx.date)}`}
          subtitle={[tx.category, tx.description, tx.contact_name].filter(Boolean).join(" · ")}
          right={`${tx.type === "outflow" ? "-" : tx.type === "inflow" ? "+" : ""}${fmtMoney(tx.amount, tx.currency)}`}
        />
      ))}
      {canEdit ? (
        <Pressable onPress={remove} testID="bank-delete" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 }}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: "800" }}>Hesabı sil</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}
