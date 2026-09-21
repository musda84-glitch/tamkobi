import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { GroupedSelect } from "../components/GroupedSelect";
import { ErrorBanner, Field, H1, Muted, PrimaryButton, Screen } from "../components/kit";
import { colors } from "../theme";
import { validateVirman, virmanSelectGroups, type BankAccount, type Partner } from "../utils/finance";
import { n } from "../components/chips";

export function BankingVirmanScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rows, pts] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
      ]);
      setAccounts(rows || []);
      setPartners(pts || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Hesaplar yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  const pool = useMemo(() => virmanSelectGroups(accounts, partners), [accounts, partners]);

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
      <Muted>Kasa, banka, POS ve ortaklar arasında transfer. Entegre (canlı) bankalar virmana kapalı.</Muted>
      <ErrorBanner message={error} />
      <GroupedSelect
        label="Kaynak hesap"
        testID="virman-source-select"
        value={source}
        onChange={setSource}
        emptyLabel="Hesap / ortak seçin"
        groups={pool}
      />
      <GroupedSelect
        label="Hedef hesap"
        testID="virman-target-select"
        value={target}
        onChange={setTarget}
        emptyLabel="Hesap / ortak seçin"
        groups={pool}
      />
      <Field label="Tutar" testID="virman-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Field label="Açıklama" testID="virman-desc" value={desc} onChangeText={setDesc} />
      <PrimaryButton title={busy ? "Aktarılıyor…" : "Virmanı kaydet"} onPress={save} loading={busy} disabled={!canEdit} color={colors.primary} testID="submit-virman-btn" />
    </Screen>
  );
}
