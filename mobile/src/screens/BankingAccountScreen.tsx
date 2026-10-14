import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, confirmAction, n } from "../components/chips";
import { ContactSearchSelect } from "../components/ContactSearchSelect";
import { MoneyInput } from "../components/MoneyInput";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { txUserColumnLabel } from "../utils/bankMatchLabel";
import { accountBalance, accountCashTxRequest, accountTypeTr, normalizeAccountType, sortBankTransactions, txTypeTr, type BankAccount, type BankTx } from "../utils/finance";
import { fmtDate, fmtMoney, idOf, todayIso } from "../utils/money";

export function BankingAccountScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const canExp = can("/expenses", "edit");
  const { id } = useLocalSearchParams<{ id: string }>();
  const [acc, setAcc] = useState<BankAccount | null>(null);
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [txType, setTxType] = useState<"inflow" | "outflow">("inflow");
  const [amount, setAmount] = useState<string | number>("");
  const [desc, setDesc] = useState("");
  const [contactId, setContactId] = useState("");
  const [contactName, setContactName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [accounts, rows] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<BankTx[]>(client, "/banking/transactions", { company_id: companyId, account_id: id }),
      ]);
      const found = (accounts || []).find((a) => idOf(a) === id) || null;
      setAcc(found);
      setTxs(rows || []);
      setError(found ? null : "Hesap bulunamadı.");
    } catch (err) {
      setError(apiErrorMessage(err, "Hesap yüklenemedi."));
    }
  }, [client, companyId, id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
        contactName,
      });
      await post(client, req.path, req.body);
      setAmount("");
      setDesc("");
      setContactId("");
      setContactName("");
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
          <ContactSearchSelect
            label={txType === "inflow" ? "Cari" : "Cari (opsiyonel)"}
            testID="bank-tx-contact"
            value={contactId}
            valueLabel={contactName}
            emptyLabel={txType === "inflow" ? "Cari seçin" : "Cari yok — yalnız kasa"}
            placeholder="Cari adı, ünvan, VKN, telefon veya cari kodu"
            onChange={(cid, c) => { setContactId(cid); setContactName(c?.name || ""); }}
          />
          {txType === "inflow" ? <Muted>Tahsilat için cari seçin; tutar cari bakiyesine işlenir.</Muted> : null}
          <MoneyInput label="Tutar" testID="bank-tx-amount" value={amount} onChange={(n) => setAmount(n ?? "")} />
          <Field label="Açıklama" testID="bank-tx-desc" value={desc} onChangeText={setDesc} />
          <PrimaryButton title={busy ? "Kaydediliyor…" : "Hareketi kaydet"} onPress={saveTx} loading={busy} color={colors.primary} testID="bank-tx-save" />
        </Card>
      ) : isCard ? <Muted>Kredi kartında tahsilat kapalı; masraf veya ekstre kullanın.</Muted> : null}
      <Text style={{ fontWeight: "800", color: colors.text }}>Hareketler</Text>
      {!txs.length ? <Muted>Hareket yok.</Muted> : sortBankTransactions(txs).slice(0, 40).map((tx) => {
        const actor = txUserColumnLabel(tx);
        return (
          <ListRow
            key={idOf(tx)}
            testID={`bank-tx-row-${idOf(tx)}`}
            title={`${txTypeTr(tx.type)} · ${fmtDate(tx.date)}`}
            subtitle={[tx.category, tx.description, tx.contact_name, actor].filter(Boolean).join(" · ")}
            right={`${tx.type === "outflow" ? "-" : tx.type === "inflow" ? "+" : ""}${fmtMoney(tx.amount, tx.currency)}`}
          />
        );
      })}
      {canEdit ? (
        <Pressable onPress={remove} testID="bank-delete" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 }}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: "800" }}>Hesabı sil</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}
