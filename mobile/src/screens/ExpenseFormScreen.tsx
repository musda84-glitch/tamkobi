import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, Text } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip, confirmAction, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Contact } from "../types";
import {
  EXPENSE_DEFAULT_CATEGORIES,
  accountBalance,
  draftFromExpense,
  emptyExpenseDraft,
  expenseCalc,
  expensePayload,
  groupedAccounts,
  splitPaymentTarget,
  validateExpenseDraft,
  type BankAccount,
  type Expense,
  type ExpenseDraft,
  type Partner,
} from "../utils/finance";
import { fmtMoney, idOf, todayIso } from "../utils/money";

type Cat = { name?: string };

function paymentGroups(accounts: BankAccount[], partners: Partner[]) {
  const groups = groupedAccounts(accounts).map((g) => ({
    label: g.label,
    options: g.items.map((a) => ({
      value: idOf(a),
      label: `${a.account_name || a.bank_name || "Hesap"} · ${fmtMoney(accountBalance(a), a.currency)}`,
    })),
  }));
  if (partners.length) {
    groups.push({
      label: "Ortaklar",
      options: partners.map((p) => ({
        value: `partner:${idOf(p)}`,
        label: `${p.name || "Ortak"} · ${fmtMoney(p.balance)}`,
      })),
    });
  }
  return groups;
}

export function ExpenseFormScreen({ expenseId }: { expenseId?: string }) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/expenses", "edit");
  const isNew = !expenseId;
  const [draft, setDraft] = useState<ExpenseDraft>(emptyExpenseDraft(todayIso()));
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<string[]>(EXPENSE_DEFAULT_CATEGORIES);
  const [custQ, setCustQ] = useState("");
  const [catQ, setCatQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payAcc, setPayAcc] = useState("");
  const [loaded, setLoaded] = useState<Expense | null>(null);

  const set = <K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const load = useCallback(async () => {
    try {
      const [acc, cats, cnt, pars] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<Cat[]>(client, "/expenses/categories", { company_id: companyId }).catch(() => []),
        get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true }).catch(() => []),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
      ]);
      setAccounts(acc || []);
      setPartners((pars || []).filter((p) => p.is_active !== false));
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

  const payTarget = async () => {
    if (!expenseId) return;
    const target = splitPaymentTarget(payAcc);
    if (!target.account_id && !target.partner_id) { setError("Ödeme için kasa/banka/ortak seçin."); return; }
    setBusy(true);
    try {
      await post(client, `/expenses/${expenseId}/pay`, { account_id: target.account_id, partner_id: target.partner_id });
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
      <GroupedSelect
        label="Kategori"
        testID="exp-category-select"
        value={draft.category}
        onChange={(v) => canEdit && set("category", v)}
        groups={[{ label: "Kategoriler", options: categories.map((c) => ({ value: c, label: c })) }]}
      />
      <Field
        label="Yeni kategori"
        testID="exp-category-custom"
        value={catQ}
        onChangeText={setCatQ}
        placeholder="Listede yoksa yazın"
        onSubmitEditing={() => {
          const name = catQ.trim();
          if (!name) return;
          if (!categories.includes(name)) setCategories((prev) => [...prev, name]);
          set("category", name);
          setCatQ("");
        }}
        editable={canEdit}
      />
      {catQ.trim() ? (
        <PrimaryButton
          title={`Kategori: ${catQ.trim()}`}
          onPress={() => {
            const name = catQ.trim();
            if (!categories.includes(name)) setCategories((prev) => [...prev, name]);
            set("category", name);
            setCatQ("");
          }}
          color={colors.primary}
          testID="exp-cat-add"
        />
      ) : null}
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
          <GroupedSelect
            label="Ödeme (opsiyonel) — kasa, banka, kart veya ortak"
            testID="exp-pay-select"
            value={draft.account_id}
            onChange={(id) => set("account_id", id)}
            emptyLabel="Ödenmedi — borç olarak kaydet"
            groups={paymentGroups(accounts, partners)}
          />
          {draft.account_id ? <Muted>Seçili hesapla kaydedince masraf ödenmiş olur.</Muted> : <Muted>Boş bırakırsanız borç olarak kaydedilir.</Muted>}
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
          <GroupedSelect
            label="Kasa / banka / kart / ortak"
            testID="exp-pay-select-edit"
            value={payAcc}
            onChange={setPayAcc}
            emptyLabel="Hesap seçin"
            groups={paymentGroups(accounts, partners)}
          />
          <PrimaryButton title="Masrafı öde" onPress={payTarget} loading={busy} color={colors.primary} testID="exp-pay" />
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
