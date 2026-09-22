import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, StatRows } from "../components/kit";
import { colors } from "../theme";
import {
  filterPartnerTxs,
  partnerCardTone,
  partnerInitials,
  partnerTxTr,
  paymentTargetGroups,
  validatePartner,
  type BankAccount,
  type Partner,
  type PartnerSummary,
  type PartnerTx,
} from "../utils/finance";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

export function BankingPartnersPanel({
  accounts,
  onChanged,
}: {
  accounts: BankAccount[];
  onChanged: () => void;
}) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [summary, setSummary] = useState<PartnerSummary | null>(null);
  const [txs, setTxs] = useState<PartnerTx[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"none" | "add" | "tx" | "profit">("none");
  const [name, setName] = useState("");
  const [share, setShare] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [txPartner, setTxPartner] = useState("");
  const [txType, setTxType] = useState<"capital_in" | "withdrawal">("capital_in");
  const [txAmount, setTxAmount] = useState("");
  const [txAccount, setTxAccount] = useState("");
  const [txDesc, setTxDesc] = useState("");
  const [profit, setProfit] = useState("");
  const [profitAccount, setProfitAccount] = useState("");
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [payNow, setPayNow] = useState(true);
  const [openPartner, setOpenPartner] = useState<string | null>(null);

  const cashAccounts = (accounts || []).filter((a) => String(a.type || "") !== "credit_card");
  const firstCash = cashAccounts[0] ? idOf(cashAccounts[0]) : (accounts[0] ? idOf(accounts[0]) : "");

  const load = useCallback(async () => {
    try {
      const [p, s, t] = await Promise.all([
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }),
        get<PartnerSummary>(client, "/banking/partners/summary", { company_id: companyId }),
        get<PartnerTx[]>(client, "/banking/partners/transactions", { company_id: companyId }),
      ]);
      setPartners(p || []);
      setSummary(s);
      setTxs(t || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Ortak verileri yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  const savePartner = async () => {
    const invalid = validatePartner(name, share, Number(summary?.total_share_percent) || 0);
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    try {
      await post(client, "/banking/partners", {
        company_id: companyId,
        name: name.trim(),
        share_percent: n(share),
        phone: phone.trim(),
        email: email.trim(),
      });
      setMode("none");
      setName(""); setShare(""); setPhone(""); setEmail("");
      setMessage("Ortak eklendi.");
      setError(null);
      await load();
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "Ortak eklenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const saveTx = async () => {
    if (!txPartner) { setError("Ortak seçin."); return; }
    if (!(n(txAmount) > 0)) { setError("Geçerli bir tutar girin."); return; }
    if (!txAccount) { setError("Kasa / banka seçin."); return; }
    setBusy(true);
    try {
      const res = await post<{ status?: string; message?: string }>(client, "/banking/partners/transactions", {
        partner_id: txPartner,
        type: txType,
        amount: n(txAmount),
        account_id: txAccount,
        description: txDesc.trim(),
        company_id: companyId,
      });
      setMode("none");
      setTxAmount(""); setTxDesc("");
      setMessage(res?.status === "pending_approval" ? (res.message || "Onay bekleniyor.") : (txType === "capital_in" ? "Sermaye girişi kaydedildi." : "Para çekişi kaydedildi."));
      setError(null);
      await load();
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const distribute = async () => {
    if (!(n(profit) > 0)) { setError("Kâr tutarı girin."); return; }
    setBusy(true);
    try {
      const res = await post<{ message?: string }>(client, "/banking/partners/distribute-profit", {
        company_id: companyId,
        total_profit: n(profit),
        pay_now: payNow,
        account_id: profitAccount || firstCash,
        period,
      });
      setMode("none");
      setProfit("");
      setMessage(res?.message || "Kâr payı dağıtıldı.");
      setError(null);
      await load();
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "Kâr dağıtımı yapılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const txPool = paymentTargetGroups(accounts, [], { collectableOnly: txType === "capital_in" });
  const profitPool = paymentTargetGroups(accounts, [], { collectableOnly: true });

  return (
    <View testID="partners-panel" style={{ gap: 16 }}>
      <Muted>Ortak bazlı sermaye giriş/çıkışı ve kâr payı (131/331).</Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}
      {summary ? (
        <StatRows
          testID="partners-summary"
          items={[
            { key: "balance", label: "Ortak alacağı", value: fmtMoney(summary.total_balance) },
            { key: "capital", label: "Sermaye girişi", value: fmtMoney(summary.total_capital_in) },
            { key: "withdrawn", label: "Çekilen", value: fmtMoney(summary.total_withdrawn) },
            { key: "profit", label: "Dağıtılan kâr", value: fmtMoney(summary.total_profit_share) },
          ]}
        />
      ) : null}
      {canEdit ? (
        <>
          <PrimaryButton title="Ortak ekle" onPress={() => setMode("add")} color={colors.primary} testID="add-partner-btn" />
          {partners.length ? (
            <PrimaryButton title="Para koy / çek" onPress={() => { setTxPartner(idOf(partners[0])); setTxAccount(firstCash); setMode("tx"); }} color={colors.indigo} testID="partner-tx-btn" />
          ) : null}
          {partners.length ? (
            <PrimaryButton title="Kâr payı dağıt" onPress={() => { setProfitAccount(firstCash); setMode("profit"); }} color="#B45309" testID="distribute-profit-btn" />
          ) : null}
        </>
      ) : null}

      {mode === "add" ? (
        <Card testID="add-partner-modal">
          <Muted>Yeni ortak</Muted>
          <Field label="Ad soyad" testID="partner-name-input" value={name} onChangeText={setName} />
          <Field label="Ortaklık payı (%)" testID="partner-share-input" value={share} onChangeText={setShare} keyboardType="decimal-pad" />
          <Muted>Mevcut toplam: %{summary?.total_share_percent || 0}</Muted>
          <Field label="Telefon" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" />
          <PrimaryButton title="Kaydet" onPress={savePartner} loading={busy} color={colors.primary} testID="save-partner-btn" />
          <PrimaryButton title="Vazgeç" onPress={() => setMode("none")} />
        </Card>
      ) : null}

      {mode === "tx" ? (
        <Card testID="partner-tx-modal">
          <Muted>Ortak para koy / çek</Muted>
          <GroupedSelect
            label="Ortak"
            testID="partner-tx-partner-select"
            value={txPartner}
            onChange={setTxPartner}
            groups={[{ label: "Ortaklar", options: partners.map((p) => ({ value: idOf(p), label: `${p.name || "Ortak"} · %${p.share_percent || 0}` })) }]}
          />
          <Row style={{ flexWrap: "wrap" }}>
            <Chip label="Para koy" active={txType === "capital_in"} testID="partner-tx-type-in" onPress={() => setTxType("capital_in")} />
            <Chip label="Para çek" active={txType === "withdrawal"} testID="partner-tx-type-out" color={colors.danger} onPress={() => setTxType("withdrawal")} />
          </Row>
          <GroupedSelect
            label={txType === "capital_in" ? "Kasa / banka" : "Kasa / banka / kart"}
            testID="partner-tx-account-select"
            value={txAccount}
            onChange={setTxAccount}
            emptyLabel="Hesap seçin"
            groups={txPool}
          />
          <Field label="Tutar" testID="partner-tx-amount-input" value={txAmount} onChangeText={setTxAmount} keyboardType="decimal-pad" />
          <Field label="Açıklama" value={txDesc} onChangeText={setTxDesc} />
          <PrimaryButton title="İşlemi kaydet" onPress={saveTx} loading={busy} color={colors.primary} testID="save-partner-tx-btn" />
          <PrimaryButton title="Vazgeç" onPress={() => setMode("none")} />
        </Card>
      ) : null}

      {mode === "profit" ? (
        <Card testID="profit-modal">
          <Muted>Kâr payı dağıt</Muted>
          <Field label="Toplam kâr (₺)" testID="profit-amount" value={profit} onChangeText={setProfit} keyboardType="decimal-pad" />
          <Field label="Dönem (YYYY-AA)" testID="profit-period" value={period} onChangeText={setPeriod} />
          <Row>
            <Chip label="Şimdi öde" active={payNow} testID="profit-pay-now" onPress={() => setPayNow(true)} />
            <Chip label="Sonra öde" active={!payNow} testID="profit-pay-later" onPress={() => setPayNow(false)} />
          </Row>
          {payNow ? (
            <GroupedSelect
              label="Ödenecek kasa / banka"
              testID="profit-account-select"
              value={profitAccount}
              onChange={setProfitAccount}
              emptyLabel="Hesap seçin"
              groups={profitPool}
            />
          ) : null}
          <PrimaryButton title="Dağıt" onPress={distribute} loading={busy} color="#B45309" testID="save-profit-btn" />
          <PrimaryButton title="Vazgeç" onPress={() => setMode("none")} />
        </Card>
      ) : null}

      {!partners.length ? (
        <Empty icon="people-outline" title="Henüz ortak yok" hint={canEdit ? "Ortak ekleyerek sermaye hareketi kaydedin." : undefined} />
      ) : partners.map((p) => {
        const pid = idOf(p);
        const tone = partnerCardTone(pid || p.name || "");
        const open = openPartner === pid;
        const mine = filterPartnerTxs(txs, pid);
        return (
          <Pressable
            key={pid}
            testID={`partner-card-${p.name}`}
            onPress={() => setOpenPartner(open ? null : pid)}
            style={{
              backgroundColor: tone.bg,
              borderColor: open ? tone.accent : tone.border,
              borderWidth: 1,
              borderRadius: 16,
              padding: 14,
              gap: 8,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View
                testID={`partner-avatar-${pid}`}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: tone.accent,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15 }}>{partnerInitials(p.name)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: "800", color: tone.label }}>{p.name}</Text>
                <Muted>{[p.email, p.phone, `%${p.share_percent || 0}`].filter(Boolean).join(" · ")}</Muted>
              </View>
            </View>
            <Text style={{ fontSize: 20, fontWeight: "800", color: tone.amount }}>{fmtMoney(p.balance)}</Text>
            <Muted>Giriş {fmtMoney(p.total_capital_in)} · çekiş {fmtMoney(p.total_withdrawn)} · kâr {fmtMoney(p.total_profit_share)}</Muted>
            {open ? (
              <View testID={`partner-moves-${pid}`} style={{ borderTopWidth: 1, borderTopColor: tone.border, paddingTop: 8, gap: 4 }}>
                <Text style={{ fontWeight: "800", color: tone.label }}>Hareketler</Text>
                {!mine.length ? (
                  <Muted>Hareket yok.</Muted>
                ) : mine.slice(0, 40).map((tx) => (
                  <ListRow
                    key={idOf(tx)}
                    testID={`partner-tx-${idOf(tx)}`}
                    title={partnerTxTr(tx.type)}
                    subtitle={[fmtDate(tx.date), tx.account_name, tx.description].filter(Boolean).join(" · ")}
                    right={fmtMoney(tx.amount)}
                    rightColor={tx.type === "withdrawal" ? colors.danger : colors.primary}
                  />
                ))}
              </View>
            ) : null}
          </Pressable>
        );
      })}

      {!openPartner ? (
        <>
          <Text style={{ fontWeight: "800", color: colors.text }}>Ortak hareketleri</Text>
          {!txs.length ? <Muted>Hareket yok.</Muted> : txs.slice(0, 40).map((tx) => (
            <ListRow
              key={idOf(tx)}
              title={`${partnerTxTr(tx.type)} · ${tx.partner_name || ""}`}
              subtitle={[fmtDate(tx.date), tx.account_name, tx.description].filter(Boolean).join(" · ")}
              right={fmtMoney(tx.amount)}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}
