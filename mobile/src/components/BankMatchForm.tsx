import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Chip } from "./chips";
import { ContactSearchSelect } from "./ContactSearchSelect";
import { GroupedSelect } from "./GroupedSelect";
import { Field, Muted, PrimaryButton, Row } from "./kit";
import { colors } from "../theme";
import {
  canSubmitMatch,
  DEFAULT_PERSONNEL_PAY_KIND,
  employeeSelectGroups,
  isPersonnelExpenseCategory,
  matchExpenseCategoryGroups,
  matchModesForTx,
  matchTargets,
  PERSONNEL_EXPENSE_CATEGORY,
  personnelCategoryOnly,
  personnelPayKindGroups,
  transferSelectGroups,
  type BankMatchTx,
  type MatchDraft,
  type PersonnelPayKind,
} from "../utils/bankMatch";
import type { BankAccount, ExpenseCategory, Partner } from "../utils/finance";
import { expensePersonnelDebtOpen, type Employee } from "../utils/personnel";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

function openDebtOptionLabel(exp: Record<string, unknown>): string {
  const num = String(exp.expense_number || exp.number || "MSR");
  const date = fmtDate(exp.date ? String(exp.date) : "");
  const amount = exp.personnel_debt_amount ?? exp.total ?? exp.amount;
  return `${num} · ${date} · ${fmtMoney(amount)}`;
}

function hasSuggestion(tx: BankMatchTx): boolean {
  return Boolean(
    tx.suggested_contact_id || tx.suggested_contact_name
    || tx.suggested_target_account_id || tx.suggested_target_account_name
    || tx.suggested_category
  );
}

function suggestionText(tx: BankMatchTx): string {
  return [
    tx.suggested_contact_name,
    tx.suggested_target_account_name ? `${tx.suggested_target_account_name} (virman)` : "",
    tx.suggested_category,
  ].filter(Boolean).join(" · ");
}

export function BankMatchForm({
  tx,
  draft,
  setDraft,
  contactLabel,
  setContactLabel,
  accounts,
  partners,
  expenseCats,
  employees,
  busy,
  error,
  onSubmit,
  onCancel,
  replace = false,
}: {
  tx: BankMatchTx;
  draft: MatchDraft;
  setDraft: React.Dispatch<React.SetStateAction<MatchDraft>>;
  contactLabel: string;
  setContactLabel: (value: string) => void;
  accounts: BankAccount[];
  partners: Partner[];
  expenseCats: ExpenseCategory[];
  employees: Employee[];
  busy?: boolean;
  error?: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  replace?: boolean;
}) {
  const { client, companyId } = useAuth();
  const [openDebts, setOpenDebts] = useState<Record<string, unknown>[]>([]);
  const [debtsReady, setDebtsReady] = useState(false);
  const txId = idOf(tx);

  useEffect(() => {
    const employeeId = draft.employee_id;
    const show = draft.mode === "expense" && draft.personnel_pay_kind === "reimburse" && !!employeeId;
    if (!show) {
      setOpenDebts([]);
      setDebtsReady(false);
      return undefined;
    }
    let cancel = false;
    setDebtsReady(false);
    get<{ expenses?: unknown; open_personnel_debts?: unknown }>(
      client,
      `/personnel/employees/${employeeId}/card`,
      { company_id: companyId },
    ).then((data) => {
      const raw = data?.expenses || data?.open_personnel_debts || [];
      const rows = (Array.isArray(raw) ? raw : []) as Record<string, unknown>[];
      const open = rows.filter(expensePersonnelDebtOpen);
      open.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
      if (!cancel) setOpenDebts(open);
    }).catch(() => {
      if (!cancel) setOpenDebts([]);
    }).finally(() => {
      if (!cancel) setDebtsReady(true);
    });
    return () => { cancel = true; };
  }, [client, companyId, draft.mode, draft.personnel_pay_kind, draft.employee_id]);

  const targets = useMemo(() => matchTargets(accounts, tx), [accounts, tx]);
  const needPersonnel = draft.mode === "expense" && isPersonnelExpenseCategory(draft.category);
  const expenseCatGroups = useMemo(() => matchExpenseCategoryGroups(expenseCats), [expenseCats]);
  const employeeGroups = useMemo(() => employeeSelectGroups(employees), [employees]);
  const openDebtGroups = useMemo(() => {
    const options = openDebts
      .map((exp) => ({ value: idOf(exp), label: openDebtOptionLabel(exp) }))
      .filter((o) => o.value);
    return options.length ? [{ label: "Açık masraf borçları", options }] : [];
  }, [openDebts]);
  const suggested = hasSuggestion(tx) ? suggestionText(tx) : "";

  const applySuggestion = () => {
    if (tx.suggested_target_account_id) {
      setDraft((d) => ({
        ...d,
        mode: "transfer",
        target_account_id: tx.suggested_target_account_id || "",
        contact_id: "",
        category: "",
      }));
      return;
    }
    if (tx.suggested_category && !tx.suggested_contact_id) {
      setDraft((d) => ({
        ...d,
        mode: "category",
        category: tx.suggested_category || "",
        contact_id: "",
        target_account_id: "",
      }));
      return;
    }
    setDraft((d) => ({
      ...d,
      mode: "contact",
      contact_id: tx.suggested_contact_id || d.contact_id,
      target_account_id: "",
      category: "",
    }));
    if (tx.suggested_contact_name) setContactLabel(tx.suggested_contact_name);
  };

  return (
    <View>
      {suggested ? (
        <Pressable
          testID={`match-suggested-${txId}`}
          onPress={applySuggestion}
          style={{
            marginBottom: 8,
            padding: 10,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#FCD34D",
            backgroundColor: colors.amber50,
          }}
        >
          <Text style={{ fontWeight: "800", color: "#92400E" }}>★ Önerilen</Text>
          <Text style={{ color: "#92400E", fontSize: 12 }}>{suggested}</Text>
        </Pressable>
      ) : null}
      <Text style={{ fontSize: 12, fontWeight: "800", color: colors.muted, marginBottom: 6 }}>Eşleşme türü</Text>
      <Row style={{ flexWrap: "wrap" }}>
        {matchModesForTx(tx).map((m) => (
          <Chip
            key={m.key}
            label={m.label}
            active={draft.mode === m.key}
            testID={`match-mode-${m.key}`}
            onPress={() => setDraft((d) => ({
              ...d,
              mode: m.key,
              contact_id: m.key === "contact" ? (d.contact_id || tx.suggested_contact_id || "") : "",
              invoice_id: "",
              target_account_id: m.key === "transfer" ? d.target_account_id : "",
              category: m.key === "expense" || m.key === "category" ? d.category : "",
              employee_id: "",
              personnel_pay_kind: DEFAULT_PERSONNEL_PAY_KIND,
              expense_id: "",
            }))}
          />
        ))}
      </Row>
      {draft.mode === "contact" ? (
        <ContactSearchSelect
          label="Cari"
          testID={`match-contact-select-${txId}`}
          value={draft.contact_id}
          valueLabel={contactLabel}
          onChange={(id, c) => { setDraft({ ...draft, contact_id: id }); setContactLabel(c?.name || ""); }}
          emptyLabel="Cari seçin (boş = sadece onayla)"
          placeholder="Cari adı, ünvan, VKN, telefon veya cari kodu"
          suggestText={tx.description || ""}
          counterparty={tx.counterparty || tx.suggested_contact_name || ""}
        />
      ) : null}
      {draft.mode === "transfer" ? (
        <GroupedSelect
          label={tx.type === "inflow" ? "Para nereden geldi?" : "Para nereye gitti?"}
          testID={`match-target-select-${txId}`}
          value={draft.target_account_id}
          onChange={(v) => setDraft({ ...draft, target_account_id: v })}
          groups={transferSelectGroups(targets, partners)}
          emptyLabel={tx.type === "inflow" ? "Para nereden geldi?" : "Para nereye gitti?"}
        />
      ) : null}
      {draft.mode === "category" ? (
        <>
          <Field
            label="Kategori (zorunlu)"
            testID={`match-category-${txId}`}
            value={draft.category}
            onChangeText={(v) => setDraft({
              ...draft,
              category: v,
              personnel_pay_kind: DEFAULT_PERSONNEL_PAY_KIND,
              expense_id: "",
            })}
            placeholder="Kategori"
          />
          {personnelCategoryOnly(draft) ? (
            <View
              testID={`match-personnel-warn-${txId}`}
              style={{
                marginTop: 8,
                borderWidth: 1,
                borderColor: "#FDE68A",
                backgroundColor: colors.amber50,
                borderRadius: 12,
                padding: 10,
                gap: 8,
              }}
            >
              <Text style={{ color: "#92400E", fontSize: 12, fontWeight: "700" }}>
                {"Personel ödemesi için 'Masraf' modunda personel seçin."}
              </Text>
              <PrimaryButton
                title="Masraf moduna geç"
                testID={`match-goto-expense-${txId}`}
                color="#7C3AED"
                onPress={() => setDraft((d) => ({
                  ...d,
                  mode: "expense",
                  category: d.category.trim() || PERSONNEL_EXPENSE_CATEGORY,
                  personnel_pay_kind: DEFAULT_PERSONNEL_PAY_KIND,
                  expense_id: "",
                }))}
              />
            </View>
          ) : null}
        </>
      ) : null}
      {draft.mode === "expense" ? (
        <GroupedSelect
          label="Masraf kategorisi (zorunlu)"
          testID={`match-expense-cat-${txId}`}
          value={draft.category}
          onChange={(v) => setDraft({
            ...draft,
            category: v,
            employee_id: "",
            personnel_pay_kind: DEFAULT_PERSONNEL_PAY_KIND,
            expense_id: "",
          })}
          groups={expenseCatGroups}
          emptyLabel="Kategori seçin…"
        />
      ) : null}
      {needPersonnel ? (
        <>
          <GroupedSelect
            label="Ödeme türü (zorunlu)"
            testID={`match-pay-kind-${txId}`}
            value={draft.personnel_pay_kind}
            onChange={(v) => setDraft({
              ...draft,
              personnel_pay_kind: (v || DEFAULT_PERSONNEL_PAY_KIND) as PersonnelPayKind,
              expense_id: "",
            })}
            groups={personnelPayKindGroups()}
            emptyLabel="Ödeme türü"
          />
          {draft.personnel_pay_kind === "expense" ? (
            <Muted testID={`match-expense-note-${txId}`}>Personel bakiyesini değiştirmez.</Muted>
          ) : null}
          <GroupedSelect
            label="Personel (zorunlu)"
            testID={`match-employee-${txId}`}
            value={draft.employee_id}
            onChange={(v) => setDraft({ ...draft, employee_id: v, expense_id: "" })}
            groups={employeeGroups}
            emptyLabel="Personel seçin…"
          />
          {draft.personnel_pay_kind === "reimburse" && draft.employee_id ? (
            <>
              <GroupedSelect
                label="Açık masraf borcu (isteğe bağlı)"
                testID={`match-msr-${txId}`}
                value={draft.expense_id || ""}
                onChange={(v) => setDraft({ ...draft, expense_id: v })}
                groups={openDebtGroups}
                emptyLabel="Otomatik (en eski açık borçlar)"
              />
              {debtsReady && !openDebts.length ? (
                <Muted testID={`match-msr-empty-${txId}`}>
                  Açık masraf borcu görünmüyor; kaydederseniz sunucu uyarı verebilir.
                </Muted>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      <Pressable
        testID={`match-learn-${txId}`}
        onPress={() => setDraft({ ...draft, learn: !draft.learn })}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}
      >
        <Ionicons name={draft.learn ? "checkbox" : "square-outline"} size={20} color={draft.learn ? "#F59E0B" : colors.muted} />
        <Text style={{ flex: 1, fontWeight: "700", color: colors.text, fontSize: 13 }}>
          Bu açıklama tekrar gelirse otomatik eşleştir (öğren)
        </Text>
      </Pressable>
      {error ? <Text style={{ color: colors.danger, fontWeight: "700" }}>{error}</Text> : null}
      <Row>
        <Pressable
          testID={`match-cancel-${txId}`}
          onPress={onCancel}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: "#fff",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 12,
          }}
        >
          <Text style={{ fontWeight: "800", color: colors.text }}>İptal</Text>
        </Pressable>
        <View style={{ flex: 1.4 }}>
          <PrimaryButton
            title="Eşleştir"
            testID={`match-btn-${txId}`}
            color="#F59E0B"
            disabled={!canSubmitMatch(draft) || (replace && draft.mode === "contact" && !draft.contact_id)}
            loading={!!busy}
            onPress={onSubmit}
          />
        </View>
      </Row>
    </View>
  );
}
