import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { ApiHttpError } from "../api/errors";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, ErrorBanner, H1, Muted, PrimaryButton, Screen } from "../components/kit";
import { useExpenseActions } from "../hooks/useExpenseActions";
import { go } from "../nav";
import { colors } from "../theme";
import { expenseVendorName } from "../utils/expenseDisplay";
import { fetchExpenseById } from "../utils/expenseActions";
import { paymentTargetGroups, type BankAccount, type Expense, type ExpenseProject, type Partner } from "../utils/finance";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { asWorkList } from "../utils/workDocs";

function payBadge(status?: string | null): { label: string; color: string; bg: string } {
  if (status === "paid") return { label: "Ödendi", color: colors.success, bg: colors.emerald100 };
  if (status === "partially_paid") return { label: "Kısmi Ödendi", color: colors.warning, bg: colors.amber50 };
  return { label: "Ödenmedi", color: colors.warning, bg: colors.amber50 };
}

function vatLabel(expense: Expense): string {
  const rate = expense.vat_rate ?? 0;
  return `%${rate} · ${expense.vat_included ? "KDV dahil" : "KDV hariç"}`;
}

function projectLabel(expense: Expense, projects: ExpenseProject[]): string {
  const projectId = String(expense.project_id || "");
  if (!projectId) return "—";
  const project = projects.find((row) => idOf(row) === projectId);
  if (!project) return "—";
  return [project.project_number, project.name].filter(Boolean).join(" · ") || "Proje";
}

function InfoLine({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View testID={testID} style={{ gap: 2 }}>
      <Text style={{ fontWeight: "800", color: colors.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ fontWeight: "700", color: colors.text }}>{value || "—"}</Text>
    </View>
  );
}

export function ExpenseDetailScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/expenses", "edit");
  const { id } = useLocalSearchParams<{ id: string }>();
  const [exp, setExp] = useState<Expense | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [projects, setProjects] = useState<ExpenseProject[]>([]);
  const [payAcc, setPayAcc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const expRef = useRef<Expense | null>(null);

  const load = useCallback(async () => {
    try {
      const found = await fetchExpenseById(client, companyId, String(id || ""));
      if (!found) {
        expRef.current = null;
        setExp(null);
        setStatus("notfound");
        setError(null);
        return;
      }
      setExp(found);
      setPayAcc(found.account_id || "");
      setError(null);
      expRef.current = found;
      setStatus("ready");
    } catch (err) {
      const missing = err instanceof ApiHttpError && err.status === 404;
      if (missing) {
        expRef.current = null;
        setExp(null);
        setStatus("notfound");
        setError(null);
        return;
      }
      setError(apiErrorMessage(err, "Masraf yüklenemedi."));
      if (!expRef.current) setStatus("error");
    }
  }, [client, companyId, id]);

  const loadAccounts = useCallback(async () => {
    try {
      const [acc, pars, prjs] = await Promise.all([
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
        get<ExpenseProject[]>(client, "/projects", { company_id: companyId, light: 1 }).catch(() => []),
      ]);
      setAccounts(acc || []);
      setPartners((pars || []).filter((row) => row.is_active !== false));
      setProjects(asWorkList<ExpenseProject>(prjs));
    } catch {
      setAccounts([]);
      setPartners([]);
      setProjects([]);
    }
  }, [client, companyId]);

  useFocusEffect(useCallback(() => { load(); loadAccounts(); }, [load, loadAccounts]));

  const { payTarget, unpay, remove } = useExpenseActions({
    expenseId: String(id || ""),
    expense: exp,
    payAcc,
    reload: load,
    setError,
    setMessage,
    setBusy,
  });

  if (status === "loading") {
    return (
      <Screen onRefresh={load}>
        <View testID="exp-detail-loading" style={{ gap: 8 }}>
          <View style={{ height: 28, width: 160, borderRadius: 8, backgroundColor: "#E2E8F0" }} />
          <View style={{ height: 120, borderRadius: 16, backgroundColor: "#E2E8F0" }} />
          <Muted>Yükleniyor…</Muted>
        </View>
      </Screen>
    );
  }

  if (status === "notfound") {
    return (
      <Screen onRefresh={load}>
        <View testID="exp-detail-notfound">
          <ErrorBanner message="Masraf bulunamadı." />
        </View>
      </Screen>
    );
  }

  if (status === "error" || !exp) {
    return (
      <Screen onRefresh={load}>
        <ErrorBanner message={error || "Masraf yüklenemedi."} />
        <PrimaryButton title="Tekrar dene" onPress={() => { void load(); }} testID="exp-detail-retry" color={colors.primary} />
      </Screen>
    );
  }

  const badge = payBadge(exp.payment_status);
  const paid = exp.payment_status === "paid";

  return (
    <Screen onRefresh={load}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View testID="exp-detail-number" style={{ flex: 1, minWidth: 0 }}>
          <H1>{exp.expense_number || "Masraf"}</H1>
        </View>
        {canEdit ? (
          <Pressable
            testID="exp-edit"
            accessibilityLabel="Düzenle"
            onPress={() => go("ExpenseEdit", { id: String(id || "") })}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.slate100 }}
          >
            <Text style={{ fontSize: 18 }}>✏️</Text>
          </Pressable>
        ) : null}
      </View>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      <Card>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Text testID="exp-header-total" style={{ flex: 1, fontSize: 28, fontWeight: "800", color: colors.text }}>
            {fmtMoney(exp.total, exp.currency)}
          </Text>
          <View testID="exp-detail-badge" style={{ borderRadius: 999, backgroundColor: badge.bg, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Text style={{ color: badge.color, fontWeight: "800", fontSize: 11 }}>{badge.label}</Text>
          </View>
        </View>
        <Text testID="exp-detail-vendor" style={{ fontWeight: "800", fontSize: 16, color: colors.text, marginTop: 6 }}>
          {expenseVendorName(exp)}
        </Text>
        <Text testID="exp-detail-category" style={{ color: colors.muted, fontWeight: "700", marginTop: 4 }}>{exp.category || "—"}</Text>
        <Text testID="exp-detail-date" style={{ color: colors.muted, fontWeight: "700" }}>{fmtDate(exp.date)}</Text>
      </Card>
      <Card testID="exp-detail-info">
        <InfoLine label="AÇIKLAMA" testID="exp-detail-description" value={exp.description || "—"} />
        <InfoLine label="BELGE NO" testID="exp-detail-document" value={exp.document_no || "—"} />
        <InfoLine label="KDV" testID="exp-detail-vat" value={vatLabel(exp)} />
        <InfoLine label="CARİ" testID="exp-detail-contact" value={exp.contact_name || "—"} />
        <InfoLine label="PROJE" testID="exp-detail-project" value={projectLabel(exp, projects)} />
        <InfoLine label="ÖDEME HESABI" testID="exp-detail-account" value={exp.account_name || "—"} />
        <InfoLine label="NOTLAR" testID="exp-detail-notes" value={exp.notes || "—"} />
      </Card>
      {exp.is_recurring ? <Muted testID="exp-recurring-note">Bu masraf aylık tekrarlı; tekrar ayarı web panelinden yönetilir.</Muted> : null}
      {!paid && canEdit ? (
        <Card>
          <Text style={{ fontWeight: "800" }}>Öde</Text>
          <GroupedSelect
            label="Kasa / banka / kart / ortak"
            testID="exp-pay-select-edit"
            value={payAcc}
            onChange={setPayAcc}
            emptyLabel="Hesap seçin"
            groups={paymentTargetGroups(accounts, partners)}
          />
          <PrimaryButton title="Masrafı öde" onPress={payTarget} loading={busy} color={colors.primary} testID="exp-pay" />
        </Card>
      ) : null}
      {paid && canEdit ? (
        <PrimaryButton title="Ödemeyi geri al" onPress={unpay} color={colors.secondary} testID="exp-unpay" />
      ) : null}
      {canEdit ? (
        <Pressable onPress={remove} testID="exp-delete" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 }}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: "800" }}>Masrafı sil</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}
