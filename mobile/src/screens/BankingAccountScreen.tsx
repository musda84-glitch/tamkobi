import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { BankMark } from "../components/BankMark";
import { BankTxCard } from "../components/BankTxCard";
import { Chip, confirmAction, n } from "../components/chips";
import { ContactSearchSelect } from "../components/ContactSearchSelect";
import { MoneyInput } from "../components/MoneyInput";
import { Card, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { resolveBankBrand } from "../utils/bankBrand";
import { accountBalance, accountCashTxRequest, accountMaskedRef, accountTypeTr, normalizeAccountType, sortBankTransactions, type BankAccount, type BankTx } from "../utils/finance";
import { fmtMoney, idOf, todayIso } from "../utils/money";

type TxFilter = "all" | "in" | "out" | "unmatched";

function relativeSyncLabel(iso?: string | null, now = new Date()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now.getTime() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} gün önce`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} ay önce`;
  return `${Math.floor(mo / 12)} yıl önce`;
}

function monthText(value: number | null | undefined, currency?: string): string {
  if (value == null) return "—";
  return fmtMoney(value, currency);
}

export function BankingAccountScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const canExp = can("/expenses", "edit");
  const { id } = useLocalSearchParams<{ id: string }>();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [acc, setAcc] = useState<BankAccount | null>(null);
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [filter, setFilter] = useState<TxFilter>("all");
  const [menu, setMenu] = useState(false);
  const [txType, setTxType] = useState<"inflow" | "outflow">("inflow");
  const [amount, setAmount] = useState<string | number>("");
  const [desc, setDesc] = useState("");
  const [contactId, setContactId] = useState("");
  const [contactName, setContactName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, rows] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId, with_month: 1 }),
        get<BankTx[]>(client, "/banking/transactions", { company_id: companyId, account_id: id }),
      ]);
      const accounts = list || [];
      setAccounts(accounts);
      const found = accounts.find((a) => idOf(a) === id) || null;
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
    if (!canEdit || !acc || acc.is_integrated) return;
    confirmAction("Hesabı sil", `${acc.account_name} silinsin mi?`, () => {
      del(client, `/banking/accounts/${id}`)
        .then(() => router.back())
        .catch((err) => setError(apiErrorMessage(err, "Hesap silinemedi.")));
    });
  };

  const sync = async () => {
    if (!acc?.connection_id || !canEdit) return;
    setSyncing(true);
    try {
      const r = await post<{ message?: string }>(client, `/banking/connections/${acc.connection_id}/sync`, {});
      setMessage(r?.message || "Hareketler çekildi.");
      setError(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, "Senkronize edilemedi."));
    } finally {
      setSyncing(false);
    }
  };

  if (!acc) return <Screen><ErrorBanner message={error || "Hesap bulunamadı."} /></Screen>;

  const isCard = normalizeAccountType(acc.type) === "credit_card";
  const brand = resolveBankBrand(acc);
  const masked = accountMaskedRef(acc);
  const showSync = !!(acc.is_integrated && acc.connection_id && canEdit);
  const live = acc.is_integrated
    ? `${acc.integration_provider || "API"} · ${acc.integration_status === "connected" ? "CANLI" : "API"}`
    : accountTypeTr(acc.type);
  const shown = sortBankTransactions(txs).filter((tx) => {
    if (filter === "in") return tx.type === "inflow";
    if (filter === "out") return tx.type === "outflow";
    if (filter === "unmatched") return tx.match_status === "unmatched";
    return true;
  });
  const unmatchedCount = acc.unmatched_count ?? 0;

  return (
    <Screen onRefresh={load}>
      <View style={{ backgroundColor: "#0F172A", borderRadius: 18, padding: 16, gap: 12 }}>
        <Row style={{ alignItems: "center", gap: 12 }}>
          <BankMark brand={brand} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={{ color: "#fff", fontWeight: "800", fontSize: 18 }}>{acc.account_name || acc.bank_name || "Hesap"}</Text>
            <Text style={{ color: "#86EFAC", fontSize: 12, fontWeight: "800", marginTop: 2 }}>{live}</Text>
            <Text testID="bank-iban" style={{ color: "#CBD5E1", fontSize: 12, marginTop: 2 }}>{masked ? `IBAN ${masked}` : "IBAN —"}</Text>
            <Text testID="bank-last-sync" style={{ color: "#94A3B8", fontSize: 12, marginTop: 2 }}>
              Son senkron {acc.last_synced_at ? relativeSyncLabel(acc.last_synced_at) : "—"}
            </Text>
          </View>
        </Row>
        <View>
          <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "800" }}>Bakiye</Text>
          <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800" }}>{fmtMoney(accountBalance(acc), acc.currency)}</Text>
        </View>
        <Row style={{ gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "700" }}>Bu ay giriş</Text>
            <Text testID="bank-month-in" style={{ color: "#6EE7B7", fontWeight: "800", fontSize: 16 }}>{monthText(acc.month_in, acc.currency)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "700" }}>Bu ay çıkış</Text>
            <Text testID="bank-month-out" style={{ color: "#FDA4AF", fontWeight: "800", fontSize: 16 }}>{monthText(acc.month_out, acc.currency)}</Text>
          </View>
        </Row>
      </View>

      <Row style={{ gap: 8 }}>
        {showSync ? (
          <Pressable
            testID="bank-account-sync"
            onPress={sync}
            disabled={syncing}
            style={{ flex: 1, minHeight: 42, borderRadius: 12, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 }}
          >
            <Text style={{ color: "#fff", fontWeight: "800" }}>{syncing ? "Senkronize…" : "Senkronize"}</Text>
          </Pressable>
        ) : null}
        {canEdit ? (
          <Pressable
            testID="bank-account-virman"
            onPress={() => go("BankingVirman")}
            style={{ flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.text, fontWeight: "800" }}>Virman</Text>
          </Pressable>
        ) : null}
        {canEdit || canExp ? (
          <Pressable
            testID="bank-account-more"
            onPress={() => setMenu(true)}
            style={{ width: 42, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>⋯</Text>
          </Pressable>
        ) : null}
      </Row>

      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
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

      <Row style={{ flexWrap: "wrap" }}>
        <Chip label="Tümü" active={filter === "all"} testID="bank-filter-all" onPress={() => setFilter("all")} />
        <Chip label="Giriş" active={filter === "in"} testID="bank-filter-in" onPress={() => setFilter("in")} />
        <Chip label="Çıkış" active={filter === "out"} color={colors.danger} testID="bank-filter-out" onPress={() => setFilter("out")} />
        <Chip label={`Eşleşmemiş ${unmatchedCount}`} active={filter === "unmatched"} color="#F59E0B" testID="bank-filter-unmatched" onPress={() => setFilter("unmatched")} />
      </Row>

      <Text style={{ fontWeight: "800", color: colors.text }}>Hareketler</Text>
      {!shown.length ? <Muted>Hareket yok.</Muted> : shown.map((tx) => (
        <BankTxCard
          key={idOf(tx)}
          tx={tx}
          account={acc}
          accounts={accounts}
          canEdit={canEdit}
          onChanged={load}
          onMessage={setMessage}
          onError={setError}
        />
      ))}

      <B2BSheet visible={menu} title={acc.account_name || "Hesap"} onClose={() => setMenu(false)} testID="bank-account-menu">
        {canEdit ? (
          <Pressable testID="bank-edit" onPress={() => { setMenu(false); go("BankingEdit", { id }); }} style={{ paddingVertical: 12 }}>
            <Text style={{ fontWeight: "800", color: colors.text }}>Hesabı düzenle</Text>
          </Pressable>
        ) : null}
        {canExp ? (
          <Pressable testID="bank-expense-btn" onPress={() => { setMenu(false); go("ExpenseNew", { account_id: id }); }} style={{ paddingVertical: 12 }}>
            <Text style={{ fontWeight: "800", color: colors.danger }}>Masraf ekle</Text>
          </Pressable>
        ) : null}
        {canEdit ? (
          <Pressable
            testID="bank-delete"
            disabled={!!acc.is_integrated}
            onPress={() => { if (acc.is_integrated) return; setMenu(false); remove(); }}
            style={{ paddingVertical: 12, opacity: acc.is_integrated ? 0.35 : 1, flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={{ color: colors.danger, fontWeight: "800" }}>{acc.is_integrated ? "Entegre hesap silinemez" : "Hesabı sil"}</Text>
          </Pressable>
        ) : null}
      </B2BSheet>
    </Screen>
  );
}
