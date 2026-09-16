import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, confirmAction, n } from "../components/chips";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Contact } from "../types";
import {
  EXPENSE_DEFAULT_CATEGORIES,
  draftFromExpense,
  emptyExpenseDraft,
  expenseCalc,
  expensePayload,
  validateExpenseDraft,
  type BankAccount,
  type Expense,
  type ExpenseDraft,
} from "../utils/finance";
import { fmtMoney, idOf, todayIso } from "../utils/money";

type Cat = { name?: string };

export function ExpenseFormScreen({ expenseId }: { expenseId?: string }) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/expenses", "edit");
  const isNew = !expenseId;
  const [draft, setDraft] = useState<ExpenseDraft>(emptyExpenseDraft(todayIso()));
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<string[]>(EXPENSE_DEFAULT_CATEGORIES);
  const [custQ, setCustQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payAcc, setPayAcc] = useState("");
  const [loaded, setLoaded] = useState<Expense | null>(null);

  const set = <K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const load = useCallback(async () => {
    try {
      const [acc, cats, cnt] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<Cat[]>(client, "/expenses/categories", { company_id: companyId }).catch(() => []),
        get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true }).catch(() => []),
      ]);
      setAccounts(acc || []);
      const names = (cats || []).map((c) => c.name || "").filter(Boolean);
      setCategories(names.length ? names : EXPENSE_DEFAULT_CATEGORIES);
      setContacts((cnt || []).filter((c) => c.type !== "customer"));
      if (expenseId) {
        const list = await get<{ expenses?: Expense[] }>(client, "/expenses", { company_id: companyId, q: expenseId });
        const found = (list.expenses || []).find((e) => idOf(e) === expenseId)
          || (list.expenses || [])[0];
        // Prefer exact id match from unfiltered fetch if search by id fails
        let exp = found && idOf(found) === expenseId ? found : null;
        if (!exp) {
          const all = await get<{ expenses?: Expense[] }>(client, "/expenses", { company_id: companyId });
          exp = (all.expenses || []).find((e) => idOf(e) === expenseId) || null;
        }
        if (!exp) { setError("Masraf bulunamadı."); return; }
        setLoaded(exp);
        setDraft(draftFromExpense(exp, todayIso()));
        setPayAcc(exp.account_id || "");
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Masraf yüklenemedi."));
    }
  }, [client, companyId, expenseId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const totals = expenseCalc(draft);
  const hits = custQ.trim().length < 2
    ? []
    : contacts.filter((c) => c.name.toLowerCase().includes(custQ.trim().toLowerCase())).slice(0, 8);

  const save = async () => {
    const invalid = validateExpenseDraft(draft);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Masraf yetkiniz yok."); return; }
    setBusy(true);
    try {
      if (isNew) {
        await post(client, "/expenses", expensePayload(draft, companyId));
        router.back();
      } else {
        await put(client, `/expenses/${expenseId}`, expensePayload(draft, companyId));
        setMessage("Masraf güncellendi.");
        await load();
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Masraf kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!expenseId || !payAcc) { setError("Ödeme için kasa/banka seçin."); return; }
    setBusy(true);
    try {
      await post(client, `/expenses/${expenseId}/pay`, { account_id: payAcc });
      setMessage("Masraf ödendi.");
      await load();
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Ödenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const unpay = () => {
    if (!expenseId) return;
    confirmAction("Ödemeyi geri al", "Kasa/banka bakiyesi düzeltilir.", () => {
      post(client, `/expenses/${expenseId}/unpay`)
        .then(() => { setMessage("Ödeme geri alındı."); load(); })
        .catch((err) => setError(apiErrorMessage(err, "İşlem başarısız.")));
    });
  };

  const remove = () => {
    if (!expenseId) return;
    confirmAction("Masrafı sil", `${loaded?.expense_number || "Bu masraf"} silinsin mi?`, () => {
      del(client, `/expenses/${expenseId}`)
        .then(() => router.back())
        .catch((err) => setError(apiErrorMessage(err, "Silinemedi.")));
    });
  };

  return (
    <Screen>
      <H1>{isNew ? "Yeni masraf" : loaded?.expense_number || "Masraf"}</H1>
      <Muted>Kira, fatura, yakıt — kasa/banka ile ödenebilir.</Muted>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      <Field label="Tarih" testID="exp-date" value={draft.date} onChangeText={(v) => set("date", v)} placeholder="YYYY-MM-DD" editable={canEdit} />
      <Muted>Kategori</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {categories.slice(0, 16).map((c) => (
          <Chip key={c} label={c} active={draft.category === c} onPress={() => canEdit && set("category", c)} />
        ))}
      </Row>
      <Field label="Açıklama" testID="exp-description" value={draft.description} onChangeText={(v) => set("description", v)} editable={canEdit} />
      <Field label="Tutar" testID="exp-amount" value={draft.amount} onChangeText={(v) => set("amount", v)} keyboardType="decimal-pad" editable={canEdit} />
      <Muted>KDV %</Muted>
      <Row>
        {[0, 1, 10, 20].map((v) => (
          <Chip key={v} label={`%${v}`} active={n(draft.vat_rate) === v} onPress={() => canEdit && set("vat_rate", String(v))} />
        ))}
      </Row>
      <Chip label="Tutar KDV dahil" active={draft.vat_included} onPress={() => canEdit && set("vat_included", !draft.vat_included)} testID="exp-vat-included" />
      <Card>
        <Row style={{ justifyContent: "space-between" }}><Muted>Net</Muted><Text>{fmtMoney(totals.net)}</Text></Row>
        <Row style={{ justifyContent: "space-between" }}><Muted>KDV</Muted><Text testID="exp-vat-amount">{fmtMoney(totals.vat)}</Text></Row>
        <Row style={{ justifyContent: "space-between" }}><Text style={{ fontWeight: "800" }}>Toplam</Text><Text style={{ fontWeight: "800", color: colors.danger }} testID="exp-total">{fmtMoney(totals.total)}</Text></Row>
      </Card>
      {isNew ? (
        <>
          <Muted>Ödeme (opsiyonel)</Muted>
          {accounts.slice(0, 12).map((a) => (
            <ListRow key={idOf(a)} title={a.account_name || "Hesap"} subtitle={fmtMoney(a.current_balance, a.currency)} onPress={() => set("account_id", idOf(a) === draft.account_id ? "" : idOf(a))} />
          ))}
          {draft.account_id ? <Muted>Seçili: {accounts.find((a) => idOf(a) === draft.account_id)?.account_name}</Muted> : <Muted>Boş bırakırsanız borç olarak kaydedilir.</Muted>}
        </>
      ) : null}
      <Field label="Tedarikçi ara" value={custQ} onChangeText={setCustQ} placeholder="Cari" />
      {hits.map((c) => (
        <ListRow key={idOf(c)} title={c.name} onPress={() => { set("contact_id", idOf(c)); setCustQ(""); }} />
      ))}
      {draft.contact_id ? <Muted>Tedarikçi seçildi</Muted> : null}
      <Field label="Belge / fiş no" value={draft.document_no} onChangeText={(v) => set("document_no", v)} editable={canEdit} />
      <Field label="Not" value={draft.notes} onChangeText={(v) => set("notes", v)} editable={canEdit} />
      <Chip label="Her ay tekrarlansın" active={draft.is_recurring} onPress={() => canEdit && set("is_recurring", !draft.is_recurring)} testID="exp-recurring" />
      <PrimaryButton
        title={busy ? "Kaydediliyor…" : isNew ? (draft.account_id ? "Kaydet & öde" : "Kaydet") : "Güncelle"}
        onPress={save}
        loading={busy}
        disabled={!canEdit}
        color={colors.danger}
        testID="exp-save"
      />
      {!isNew && loaded?.payment_status !== "paid" && canEdit ? (
        <Card>
          <Text style={{ fontWeight: "800" }}>Öde</Text>
          {accounts.slice(0, 12).map((a) => (
            <ListRow key={idOf(a)} title={a.account_name || "Hesap"} onPress={() => setPayAcc(idOf(a))} />
          ))}
          <PrimaryButton title="Masrafı öde" onPress={pay} loading={busy} color={colors.primary} testID="exp-pay" />
        </Card>
      ) : null}
      {!isNew && loaded?.payment_status === "paid" && canEdit ? (
        <PrimaryButton title="Ödemeyi geri al" onPress={unpay} color={colors.secondary} testID="exp-unpay" />
      ) : null}
      {!isNew && canEdit ? (
        <Pressable onPress={remove} testID="exp-delete" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 }}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: "800" }}>Masrafı sil</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

export function ExpenseFormRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <ExpenseFormScreen expenseId={id} />;
}
