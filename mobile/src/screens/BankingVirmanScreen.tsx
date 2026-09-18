import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { GroupedSelect } from "../components/GroupedSelect";
import { ErrorBanner, Field, H1, Muted, PrimaryButton, Screen } from "../components/kit";
import { colors } from "../theme";
import { paymentTargetGroups, validateVirman, virmanAccounts, type BankAccount } from "../utils/finance";
import { n } from "../components/chips";

export function BankingVirmanScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId });
      const manual = virmanAccounts(rows || []);
      setAccounts(manual);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Hesaplar yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  const pool = paymentTargetGroups(accounts, [], { includePartners: false });

  const save = async () => {
    const invalid = validateVirman(source, target, amount);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Virman yetkiniz yok."); return; }
    setBusy(true);
    try {
      await post(client, "/banking/virman", {
        company_id: companyId,
        source_account_id: source,
        target_account_id: target,
        amount: n(amount),
        description: desc.trim() || "Virman",
      });
      router.back();
    } catch (err) {
      setError(apiErrorMessage(err, "Virman işlemi gerçekleştirilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <H1>Virman</H1>
      <Muted>Entegre (canlı banka) hesaplar virmana kapalı.</Muted>
      <ErrorBanner message={error} />
      <GroupedSelect
        label="Kaynak hesap"
        testID="virman-source-select"
        value={source}
        onChange={setSource}
        emptyLabel="Hesap seçin"
        groups={pool}
      />
      <GroupedSelect
        label="Hedef hesap"
        testID="virman-target-select"
        value={target}
        onChange={setTarget}
        emptyLabel="Hesap seçin"
        groups={pool}
      />
      <Field label="Tutar" testID="virman-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Açıklama" testID="virman-desc" value={desc} onChangeText={setDesc} />
      <PrimaryButton title={busy ? "Aktarılıyor…" : "Virmanı kaydet"} onPress={save} loading={busy} disabled={!canEdit} color={colors.primary} testID="submit-virman-btn" />
    </Screen>
  );
}
