import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { colors } from "../theme";
import {
  accountDisplayLabel,
  isBankingBankAccount,
  isBankingCashAccount,
  isPartnerCashType,
  partnerTxPayload,
  type BankAccount,
  type Partner,
} from "../utils/finance";
import { fmtMoney, idOf } from "../utils/money";
import { B2BSheet } from "./b2b/B2BSheet";
import { GroupedSelect } from "./GroupedSelect";
import { ErrorBanner, Field, Muted, PrimaryButton } from "./kit";
import { MoneyInput } from "./MoneyInput";

export type PartnerTxKind = "capital_in" | "withdrawal" | "credit" | "debit";

export const PARTNER_TX_KIND_LABEL: Record<PartnerTxKind, string> = {
  capital_in: "Para Koy",
  withdrawal: "Para Çek",
  credit: "Alacaklandır",
  debit: "Borçlandır",
};

const KIND_STYLE: Record<PartnerTxKind, { color: string; filled: boolean }> = {
  capital_in: { color: "#059669", filled: true },
  withdrawal: { color: "#E11D48", filled: true },
  credit: { color: "#E11D48", filled: false },
  debit: { color: "#BE123C", filled: false },
};

export function partnerCashAccounts(accounts: BankAccount[] | null | undefined): BankAccount[] {
  return (accounts || []).filter((account) => !account.is_integrated && (isBankingCashAccount(account) || isBankingBankAccount(account)));
}

function accountOptionLabel(account: BankAccount): string {
  const name = accountDisplayLabel(account);
  return `${name} · ${fmtMoney(account.current_balance ?? account.balance, account.currency)}`;
}

export function PartnerTxSheet({
  visible,
  onClose,
  partners,
  accounts,
  partnerId,
  type,
  lockPartner,
  lockType,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  partners: Partner[];
  accounts: BankAccount[];
  partnerId?: string | null;
  type?: PartnerTxKind | null;
  lockPartner?: boolean;
  lockType?: boolean;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const { client, companyId } = useAuth();
  const [kindState, setKindState] = useState<PartnerTxKind>(type || "capital_in");
  const [pid, setPid] = useState(partnerId || "");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cashAccounts = useMemo(() => partnerCashAccounts(accounts), [accounts]);
  const defaultAccountId = idOf(cashAccounts[0]);
  const activeKind: PartnerTxKind = lockType && type ? type : kindState;
  const selectedAccount = accountId || defaultAccountId;
  const cash = isPartnerCashType(activeKind);
  const partnerSeed = partnerId || idOf(partners[0]) || "";

  useEffect(() => {
    if (!visible) return;
    setKindState(type || "capital_in");
    setPid(partnerSeed);
    setAccountId("");
    setAmount(null);
    setDescription("");
    setError(null);
    setBusy(false);
  }, [visible, type, partnerId, partnerSeed]);

  const groups = useMemo(() => {
    const cashRows = cashAccounts.filter((account) => isBankingCashAccount(account));
    const bankRows = cashAccounts.filter((account) => isBankingBankAccount(account));
    return [
      cashRows.length ? {
        label: "Kasa",
        options: cashRows.map((account) => ({ value: idOf(account), label: accountOptionLabel(account) })),
      } : null,
      bankRows.length ? {
        label: "Banka hesabı",
        options: bankRows.map((account) => ({ value: idOf(account), label: accountOptionLabel(account) })),
      } : null,
    ].filter(Boolean) as { label: string; options: { value: string; label: string }[] }[];
  }, [cashAccounts]);

  const save = async () => {
    if (busy) return;
    const value = Number(amount);
    if (!(value > 0)) {
      setError("Tutar sıfırdan büyük olmalıdır.");
      return;
    }
    if (!pid) {
      setError("Ortak seçin.");
      return;
    }
    if (cash && !selectedAccount) {
      setError("Kasa veya banka hesabı seçin.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = partnerTxPayload({
        partner_id: pid,
        type: activeKind,
        amount: value,
        account_id: cash ? selectedAccount : null,
        description,
        company_id: companyId,
      });
      const res = await post<{ status?: string; message?: string }>(client, "/banking/partners/transactions", payload);
      const label = PARTNER_TX_KIND_LABEL[activeKind] || "İşlem";
      const message = res?.status === "pending_approval"
        ? (res.message || "Onay bekliyor.")
        : `${label} kaydedildi.`;
      onClose();
      await onSaved(message);
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <B2BSheet
      visible={visible}
      title={lockType ? (PARTNER_TX_KIND_LABEL[activeKind] || "Ortak hareketi") : "Para Giriş / Çıkış"}
      subtitle={lockPartner ? (partners.find((p) => idOf(p) === pid)?.name || undefined) : undefined}
      onClose={onClose}
      testID="partner-tx-sheet"
    >
      <Text testID="partner-tx-type" style={{ height: 0, opacity: 0, fontSize: 1 }}>{activeKind}</Text>
      <ErrorBanner message={error} />
      {!lockPartner ? (
        <GroupedSelect
          label="Ortak"
          testID="partner-tx-partner"
          value={pid}
          onChange={setPid}
          groups={[{
            label: "Ortak",
            options: partners.map((partner) => ({ value: idOf(partner), label: partner.name || "Ortak" })),
          }]}
          emptyLabel="Ortak seçin"
        />
      ) : null}
      {!lockType ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {(Object.keys(PARTNER_TX_KIND_LABEL) as PartnerTxKind[]).map((key) => {
            const style = KIND_STYLE[key];
            const active = activeKind === key;
            return (
              <Pressable
                key={key}
                testID={`partner-tx-pick-${key}`}
                onPress={() => setKindState(key)}
                style={{
                  flexBasis: "47%",
                  flexGrow: 1,
                  minHeight: 42,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: style.color,
                  backgroundColor: active && style.filled ? style.color : active ? "#FFF1F2" : "#fff",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 8,
                }}
              >
                <Text style={{ fontWeight: "800", color: active && style.filled ? "#fff" : style.color }}>{PARTNER_TX_KIND_LABEL[key]}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {cash ? (
        <GroupedSelect
          label="Hesap"
          testID="partner-tx-account"
          value={selectedAccount}
          onChange={setAccountId}
          groups={groups}
          emptyLabel={cashAccounts.length ? undefined : "Kasa veya banka yok"}
        />
      ) : (
        <Muted>Kasa ve banka bakiyesi değişmez. Ortak bakiyesine fiş yazılır.</Muted>
      )}
      <MoneyInput label="Tutar" testID="partner-tx-amount" value={amount} onChange={setAmount} />
      <Field
        label="Açıklama"
        testID="partner-tx-description"
        value={description}
        onChangeText={setDescription}
        placeholder={cash ? "Örn: Sermaye artırımı" : "Örn: Açılış bakiyesi / düzeltme"}
      />
      <PrimaryButton
        title={busy ? "Kaydediliyor…" : "Kaydet"}
        onPress={save}
        loading={busy}
        color={colors.indigo}
        testID="partner-tx-save"
      />
    </B2BSheet>
  );
}
