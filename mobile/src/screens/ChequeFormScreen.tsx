import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Contact } from "../types";
import { printChequeReceipt } from "../utils/chequeShare";
import {
  CHEQUE_DIRECTIONS,
  CHEQUE_INSTRUMENTS,
  applyChequePrefill,
  chequeAction,
  chequeReturnContact,
  chequeLedgerLocked,
  chequePayload,
  chequeReceiptLabel,
  chequeStatusTr,
  chequeTitle,
  draftFromCheque,
  emptyChequeDraft,
  validateChequeDraft,
  type Cheque,
  type ChequeDraft,
} from "../utils/cheques";
import { collectableAccounts, splitPaymentTarget } from "../utils/contactDraft";
import { paymentTargetGroups, type BankAccount } from "../utils/finance";
import { fmtDate, fmtMoney, idOf, todayIso } from "../utils/money";

type Partner = { id?: string; _id?: string; name?: string; is_active?: boolean; balance?: number };

export function ChequeFormScreen({ chequeId }: { chequeId?: string }) {
  const { client, companyId, can, activeCompany } = useAuth();
  const prefill = useLocalSearchParams<{
    contact_id?: string;
    contact_name?: string;
    instrument?: string;
    direction?: string;
    amount?: string;
    notes?: string;
  }>();
  const canEdit = can("/cheques", "edit");
  const isNew = !chequeId;
  const [draft, setDraft] = useState<ChequeDraft>(() => applyChequePrefill(emptyChequeDraft(todayIso()), prefill));
  const [loaded, setLoaded] = useState<Cheque | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [custQ, setCustQ] = useState("");
  const [settleAcc, setSettleAcc] = useState("");
  const [settleDate, setSettleDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const set = <K extends keyof ChequeDraft>(key: K, value: ChequeDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const locked = chequeLedgerLocked(loaded);

  const load = useCallback(async () => {
    try {
      const rows = await get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true });
      setContacts(rows || []);
      if (chequeId) {
        const row = await get<Cheque>(client, `/cheques/${chequeId}`);
        setLoaded(row);
        setDraft(draftFromCheque(row, todayIso()));
        setSettleDate(todayIso());
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, isNew ? "Cari listesi yüklenemedi." : "Çek / senet yüklenemedi."));
    }
  }, [chequeId, client, companyId, isNew]);

  useEffect(() => { load(); }, [load]);

  const hits = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (s.length < 2) return [];
    return contacts
      .filter((c) => [c.name, c.phone, c.tax_number_or_id, c.city].some((v) => String(v || "").toLowerCase().includes(s)))
      .slice(0, 8);
  }, [contacts, custQ]);

  const save = async () => {
    const invalid = validateChequeDraft(draft);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Çek / senet kaydı yetkiniz yok."); return; }
    setBusy(true);
    try {
      if (isNew) {
        await post(client, "/cheques", chequePayload(draft, companyId));
        const back = chequeReturnContact(prefill);
        if (back) {
          router.replace({ pathname: "/contacts/[id]", params: { id: back.id, name: back.name } });
        } else {
          router.back();
        }
        return;
      }
      const saved = await put<Cheque>(client, `/cheques/${chequeId}`, chequePayload(draft, companyId));
      setLoaded(saved);
      setDraft(draftFromCheque(saved, todayIso()));
      setMessage("Çek / senet güncellendi.");
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Çek / senet kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const printReceipt = async () => {
    const row = loaded || { ...chequePayload(draft, companyId), contact_name: draft.contact_name, id: chequeId } as Cheque;
    setBusy(true);
    try {
      await printChequeReceipt(row, activeCompany, client);
      setMessage(`${chequeReceiptLabel(row)} yazdırmaya gönderildi.`);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Makbuz yazdırılamadı."));
    } finally {
      setBusy(false);
    }
  };

  const openSettle = async () => {
    if (!loaded) return;
    const action = chequeAction(loaded);
    if (!action) return;
    const [accs, pars] = await Promise.all([
      get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }).catch(() => []),
      get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
    ]);
    setAccounts(accs || []);
    setPartners(pars || []);
    const pool = action.path === "collect" ? collectableAccounts(accs || []) : (accs || []);
    setSettleAcc(pool[0] ? idOf(pool[0]) : "");
  };

  const saveSettle = async () => {
    if (!loaded || !chequeId) return;
    const action = chequeAction(loaded);
    if (!action) return;
    const target = splitPaymentTarget(settleAcc);
    if (!target.account_id && !target.partner_id) { setError("Kasa / banka veya ortak seçin."); return; }
    setBusy(true);
    try {
      const saved = await post<Cheque>(client, `/cheques/${chequeId}/${action.path}`, {
        account_id: target.account_id,
        partner_id: target.partner_id,
        date: settleDate,
      });
      setLoaded(saved);
      setDraft(draftFromCheque(saved, todayIso()));
      setSettleAcc("");
      setMessage(action.path === "collect" ? "Çek / senet tahsil edildi." : "Çek / senet ödendi.");
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const kind = draft.instrument === "promissory" ? "Senet" : "Çek";
  const action = loaded ? chequeAction(loaded) : null;

  return (
    <Screen>
      <H1>{isNew ? (draft.instrument === "promissory" ? "Yeni senet" : "Yeni çek") : "Çek / senet düzenle"}</H1>
      <Muted>
        {isNew
          ? "Kayıt cari bakiyesine işlenir; portföyde “açık” olarak başlar."
          : loaded
            ? `${chequeTitle(loaded)} · ${chequeStatusTr(loaded)} · ${fmtMoney(loaded.amount)} · vade ${fmtDate(loaded.due_date)}`
            : "Kayıt yükleniyor…"}
      </Muted>
      <ErrorBanner message={error} />
      {message ? <Muted>{message}</Muted> : null}

      {!isNew ? (
        <PrimaryButton
          title={loaded ? chequeReceiptLabel(loaded) : "Makbuz yazdır"}
          onPress={printReceipt}
          disabled={!loaded || busy}
          color={colors.primary}
          testID="cheque-print-receipt"
        />
      ) : null}

      <Muted>Yön</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {CHEQUE_DIRECTIONS.map((d) => (
          <Chip
            key={d.key}
            label={d.label}
            active={draft.direction === d.key}
            testID={`cheque-direction-${d.key}`}
            onPress={() => !locked && set("direction", d.key)}
          />
        ))}
      </Row>
      <Muted>Tür</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {CHEQUE_INSTRUMENTS.map((i) => (
          <Chip
            key={i.key}
            label={i.label}
            active={draft.instrument === i.key}
            testID={`cheque-instrument-${i.key}`}
            onPress={() => !locked && set("instrument", i.key)}
          />
        ))}
      </Row>
      {locked ? <Muted>Tahsil / ödeme sonrası yön, tür, cari ve tutar kilitlenir.</Muted> : null}

      <Card>
        <Muted>Cari</Muted>
        {draft.contact_id ? (
          <ListRow
            testID="cheque-contact-selected"
            title={draft.contact_name || "Cari"}
            subtitle={locked ? "Kilitli" : "Değiştirmek için dokunun"}
            onPress={locked ? undefined : () => setDraft((d) => ({ ...d, contact_id: "", contact_name: "" }))}
          />
        ) : (
          <>
            <Field label="Cari ara" testID="cheque-contact-search" value={custQ} onChangeText={setCustQ} placeholder="Ad / VKN / telefon" />
            {hits.map((c) => (
              <ListRow
                key={idOf(c)}
                testID={`cheque-contact-${idOf(c)}`}
                title={c.name}
                subtitle={[c.city, c.phone].filter(Boolean).join(" · ")}
                onPress={() => { setDraft((d) => ({ ...d, contact_id: idOf(c), contact_name: c.name })); setCustQ(""); }}
              />
            ))}
          </>
        )}
      </Card>

      <Field label="Tutar (₺)" testID="cheque-amount" value={draft.amount} onChangeText={(v) => !locked && set("amount", v)} keyboardType="decimal-pad" editable={!locked} />
      <Field label={`${kind} no`} testID="cheque-serial" value={draft.serial_no} onChangeText={(v) => set("serial_no", v)} autoCapitalize="characters" />
      <Field label="Keşide tarihi" testID="cheque-issue-date" value={draft.issue_date} onChangeText={(v) => set("issue_date", v)} placeholder="YYYY-AA-GG" />
      <Field label="Vade" testID="cheque-due-date" value={draft.due_date} onChangeText={(v) => set("due_date", v)} placeholder="YYYY-AA-GG" />
      {draft.instrument === "cheque" ? (
        <>
          <Field label="Banka" testID="cheque-bank" value={draft.bank_name} onChangeText={(v) => set("bank_name", v)} placeholder="Örn: Garanti BBVA" />
          <Field label="Şube" testID="cheque-branch" value={draft.bank_branch} onChangeText={(v) => set("bank_branch", v)} />
          <Field label="Hesap no" testID="cheque-account-no" value={draft.account_no} onChangeText={(v) => set("account_no", v)} />
        </>
      ) : null}
      <Field label="Keşideci" testID="cheque-drawer" value={draft.drawer_name} onChangeText={(v) => set("drawer_name", v)} placeholder="Boşsa cari adı kullanılır" />
      <Field label="Not" testID="cheque-notes" value={draft.notes} onChangeText={(v) => set("notes", v)} multiline />

      <PrimaryButton
        title={busy ? "Kaydediliyor…" : isNew ? "Kaydet" : "Güncelle"}
        onPress={save}
        loading={busy}
        disabled={!canEdit}
        color={colors.primary}
        testID="cheque-save"
      />

      {action && canEdit ? (
        <Card testID="cheque-settle-form">
          <Muted>{action.label} — kasa / banka veya ortak seçin</Muted>
          {!accounts.length && !partners.length ? (
            <PrimaryButton title="Hesapları yükle" onPress={openSettle} testID="cheque-settle-load" />
          ) : (
            <>
              <GroupedSelect
                label={action.path === "collect" ? "Tahsil hesabı (kredi kartı yok)" : "Ödeme hesabı"}
                testID="cheque-settle-account"
                value={settleAcc}
                onChange={setSettleAcc}
                emptyLabel="Hesap seçin"
                groups={paymentTargetGroups(accounts, partners, { collectableOnly: action.path === "collect" })}
              />
              <Field label="Tarih" testID="cheque-settle-date" value={settleDate} onChangeText={setSettleDate} placeholder="YYYY-AA-GG" />
              <PrimaryButton
                title={action.label}
                onPress={saveSettle}
                loading={busy}
                color={colors.primary}
                testID="cheque-settle-save"
              />
            </>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}
