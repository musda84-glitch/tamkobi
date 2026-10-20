import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ChequeScanButtons } from "../components/ChequeScanButtons";
import { ContactSearchSelect } from "../components/ContactSearchSelect";
import { DateField } from "../components/DateField";
import { GroupedSelect } from "../components/GroupedSelect";
import { MoneyInput } from "../components/MoneyInput";
import { Badge, Card, ErrorBanner, Field, Muted, PrimaryButton, Screen } from "../components/kit";
import { colors } from "../theme";
import { applyChequeScan, scannedChequeFields } from "../utils/chequeScan";
import { printChequeReceipt } from "../utils/chequeShare";
import {
  CHEQUE_KINDS,
  applyChequeKind,
  applyChequePrefill,
  chequeAction,
  chequeKindOf,
  chequeLedgerLocked,
  chequePayload,
  chequeReceiptLabel,
  chequeReturnContact,
  chequeStatusTr,
  chequeTone,
  draftFromCheque,
  emptyChequeDraft,
  validateChequeDraft,
  type Cheque,
  type ChequeDraft,
} from "../utils/cheques";
import { collectableAccounts, splitPaymentTarget } from "../utils/contactDraft";
import { paymentTargetGroups, type BankAccount } from "../utils/finance";
import { fmtDate, idOf, todayIso } from "../utils/money";

type Partner = { id?: string; _id?: string; name?: string; is_active?: boolean; balance?: number };
type TextKey = "serial_no" | "bank_name" | "bank_branch" | "account_no" | "drawer_name" | "notes";

const scannedBox = {
  backgroundColor: colors.amber50,
  borderWidth: 1,
  borderStyle: "dotted" as const,
  borderColor: "#F59E0B",
  borderRadius: 12,
  paddingHorizontal: 6,
  paddingTop: 4,
};

function ScanFrame({ on, testID, children }: { on: boolean; testID: string; children: React.ReactNode }) {
  return (
    <View testID={on ? `${testID}-scanned` : undefined} style={[{ flex: 1 }, on ? scannedBox : null]}>
      {children}
    </View>
  );
}

export function ChequeFormScreen({ chequeId }: { chequeId?: string }) {
  const { client, companyId, can, activeCompany } = useAuth();
  const prefill = useLocalSearchParams<{
    contact_id?: string;
    contact_name?: string;
    instrument?: string;
    direction?: string;
    amount?: string;
    notes?: string;
    serial_no?: string;
    bank_name?: string;
    bank_branch?: string;
    account_no?: string;
    drawer_name?: string;
    issue_date?: string;
    due_date?: string;
  }>();
  const canEdit = can("/cheques", "edit");
  const isNew = !chequeId;
  const [draft, setDraft] = useState<ChequeDraft>(() => applyChequePrefill(emptyChequeDraft(todayIso()), prefill));
  const [loaded, setLoaded] = useState<Cheque | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [settleAcc, setSettleAcc] = useState("");
  const [settleDate, setSettleDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [fromCamera, setFromCamera] = useState(false);
  const [scanned, setScanned] = useState<Set<keyof ChequeDraft>>(() => new Set());
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const clearScanned = (...keys: (keyof ChequeDraft)[]) => {
    setScanned((prev) => {
      if (!keys.some((key) => prev.has(key))) return prev;
      const next = new Set(prev);
      for (const key of keys) next.delete(key);
      return next;
    });
  };

  const set = <K extends keyof ChequeDraft>(key: K, value: ChequeDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    clearScanned(key);
  };
  const locked = chequeLedgerLocked(loaded);

  const load = useCallback(async () => {
    if (!chequeId) return;
    try {
      const row = await get<Cheque>(client, `/cheques/${chequeId}`);
      setLoaded(row);
      setDraft(draftFromCheque(row, todayIso()));
      setSettleDate(todayIso());
      setScanned(new Set());
      setFromCamera(false);
      setContactOpen(false);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Çek / senet yüklenemedi."));
    }
  }, [chequeId, client]);

  useEffect(() => { load(); }, [load]);

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
      setScanned(new Set());
      setFromCamera(false);
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
  const activeKind = chequeKindOf(draft);
  const showContactSearch = !locked && (!draft.contact_id || contactOpen);
  const contactScanned = scanned.has("contact_id") || scanned.has("contact_name");
  const recordToday = todayIso();
  const title = isNew
    ? `‹ ${draft.instrument === "promissory" ? "Yeni senet" : "Yeni çek"}`
    : `‹ ${draft.serial_no || loaded?.number || kind}`;

  const textField = (
    key: TextKey,
    label: string,
    testID: string,
    extra?: { placeholder?: string; autoCapitalize?: "characters"; multiline?: boolean },
  ) => {
    const on = scanned.has(key);
    return (
      <ScanFrame on={on} testID={testID}>
        <Field
          label={on ? `● ${label}` : label}
          testID={testID}
          value={draft[key]}
          onChangeText={(v) => set(key, v)}
          placeholder={extra?.placeholder}
          autoCapitalize={extra?.autoCapitalize}
          multiline={extra?.multiline}
          style={on ? { backgroundColor: colors.amber50, borderColor: "#F59E0B", borderStyle: "dotted" } : undefined}
        />
      </ScanFrame>
    );
  };

  const dateField = (key: "issue_date" | "due_date", label: string, testID: string, min?: string) => {
    const on = scanned.has(key);
    return (
      <ScanFrame on={on} testID={testID}>
        <DateField
          label={on ? `● ${label}` : label}
          testID={testID}
          value={draft[key]}
          onChangeText={(v) => set(key, v)}
          min={min}
        />
      </ScanFrame>
    );
  };

  const footer = (
    <PrimaryButton
      title={busy ? "Kaydediliyor…" : isNew ? "Kaydet" : "Güncelle"}
      onPress={save}
      loading={busy}
      disabled={!canEdit}
      color={colors.primary}
      testID="cheque-save"
    />
  );

  return (
    <Screen stickyBottom={footer}>
      <Pressable
        testID="cheque-form-header"
        accessibilityRole="button"
        accessibilityLabel="Geri"
        onPress={() => router.back()}
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <Text testID="cheque-form-title" numberOfLines={1} style={{ flex: 1, fontSize: 20, fontWeight: "800", color: colors.text }}>
          {title}
        </Text>
        {!isNew && loaded ? <Badge label={chequeStatusTr(loaded)} tone={chequeTone(loaded)} /> : null}
      </Pressable>

      <View testID="cheque-kind-segment" style={{ flexDirection: "row", backgroundColor: colors.slate100, borderRadius: 12, padding: 4, gap: 2 }}>
        {CHEQUE_KINDS.map((item) => {
          const active = activeKind === item.key;
          return (
            <Pressable
              key={item.key}
              testID={`cheque-kind-${item.key}`}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: locked }}
              disabled={locked}
              onPress={() => {
                if (locked) return;
                setDraft((d) => applyChequeKind(d, item.key));
                clearScanned("direction", "instrument");
              }}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 8,
                paddingHorizontal: 2,
                borderRadius: 10,
                minHeight: 44,
                backgroundColor: active ? "#fff" : "transparent",
                opacity: locked ? 0.55 : 1,
              }}
            >
              <Text numberOfLines={2} style={{ fontWeight: "800", fontSize: 11, textAlign: "center", color: active ? colors.text : colors.muted }}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {locked ? <Muted>Tahsil / ödeme sonrası yön, tür, cari ve tutar kilitlenir.</Muted> : null}

      {canEdit && !locked ? (
        <ChequeScanButtons
          variant="sheet"
          testID="cheque-scan"
          disabled={busy}
          onDraft={(scan, match) => {
            const cur = draftRef.current;
            const next = applyChequeScan(cur, scan, match);
            setScanned(scannedChequeFields(cur, next));
            setDraft(next);
            setFromCamera(true);
          }}
          onHint={(hint) => { setMessage(hint); setError(null); }}
          onError={(msg) => { setError(msg); setMessage(null); }}
        />
      ) : null}
      {fromCamera ? (
        <View
          testID="cheque-scan-banner"
          style={{ backgroundColor: colors.amber50, borderRadius: 12, borderWidth: 1, borderColor: "#F59E0B", paddingHorizontal: 12, paddingVertical: 10 }}
        >
          <Text style={{ color: "#B45309", fontWeight: "800" }}>⚠️ Kameradan okundu — kontrol et</Text>
        </View>
      ) : null}
      {message ? <Muted testID="cheque-form-message">{message}</Muted> : null}
      <ErrorBanner message={error} />

      {!isNew ? (
        <PrimaryButton
          title={loaded ? chequeReceiptLabel(loaded) : "Makbuz yazdır"}
          onPress={printReceipt}
          disabled={!loaded || busy}
          color={colors.primary}
          testID="cheque-print-receipt"
        />
      ) : null}

      <Card testID={contactScanned ? "cheque-contact-scanned" : undefined} style={contactScanned ? { backgroundColor: colors.amber50, borderColor: "#F59E0B", borderStyle: "dotted" } : undefined}>
        {draft.contact_id ? (
          <View testID="cheque-contact-selected" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text numberOfLines={2} style={{ flex: 1, fontWeight: "800", fontSize: 16, color: colors.text }}>
              {draft.contact_name || "Cari"}
            </Text>
            {locked ? <Muted>Kilitli</Muted> : (
              <Pressable testID="cheque-contact-change" onPress={() => setContactOpen((v) => !v)} hitSlop={8}>
                <Text style={{ color: "#B45309", fontWeight: "800" }}>Değiştir ›</Text>
              </Pressable>
            )}
          </View>
        ) : null}
        {showContactSearch ? (
          <ContactSearchSelect
            label={draft.contact_id ? undefined : "Cari"}
            testID="cheque-contact"
            value={draft.contact_id}
            valueLabel={draft.contact_name}
            placeholder="Ad / VKN / telefon"
            onChange={(id, contact) => {
              setDraft((d) => ({ ...d, contact_id: id, contact_name: contact?.name || (id ? d.contact_name : "") }));
              clearScanned("contact_id", "contact_name");
              setContactOpen(false);
            }}
          />
        ) : null}
      </Card>

      <Card>
        <ScanFrame on={scanned.has("amount")} testID="cheque-amount">
          <MoneyInput
            label={scanned.has("amount") ? "● Tutar (₺)" : "Tutar (₺)"}
            testID="cheque-amount"
            value={draft.amount}
            onChange={(n) => { if (!locked) set("amount", n ?? ""); }}
            editable={!locked}
            containerStyle={{ marginBottom: 0 }}
            style={{ fontSize: 32, fontWeight: "800", minHeight: 64 }}
          />
        </ScanFrame>
      </Card>

      {draft.instrument === "cheque" ? (
        <>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            {textField("bank_name", "Banka", "cheque-bank", { placeholder: "Örn: Garanti BBVA" })}
            {textField("bank_branch", "Şube", "cheque-branch")}
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            {textField("serial_no", `${kind} no`, "cheque-serial", { autoCapitalize: "characters" })}
            {textField("account_no", "Hesap no", "cheque-account-no")}
          </View>
        </>
      ) : textField("serial_no", `${kind} no`, "cheque-serial", { autoCapitalize: "characters" })}
      {textField("drawer_name", "Keşideci", "cheque-drawer", { placeholder: "Boşsa cari adı kullanılır" })}

      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        {dateField("issue_date", "Keşide tarihi (çek üzerindeki)", "cheque-issue-date")}
        {dateField("due_date", "Vade", "cheque-due-date", draft.issue_date || undefined)}
      </View>

      <View
        testID="cheque-record-date"
        style={{ backgroundColor: colors.slate100, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
      >
        <Text style={{ color: colors.slate800, fontWeight: "700" }}>
          {`🗓 Kayıt tarihi · bugün · ${fmtDate(recordToday)}`}
        </Text>
      </View>

      {textField("notes", "Not", "cheque-notes", { multiline: true })}

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
              <DateField label="Tarih" testID="cheque-settle-date" value={settleDate} onChangeText={setSettleDate} />
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
