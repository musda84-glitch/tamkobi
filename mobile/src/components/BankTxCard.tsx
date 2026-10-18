import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "./b2b/B2BSheet";
import { BankMatchForm } from "./BankMatchForm";
import { confirmAction } from "./chips";
import { colors } from "../theme";
import { emptyMatchDraft, type MatchDraft } from "../utils/bankMatch";
import { replaceMatchDraft, submitMatch, txMatchState, unmatchTx } from "../utils/bankMatchActions";
import { sanitizeActorLabel, txCreatedSourceLabel, txUserColumnLabel } from "../utils/bankMatchLabel";
import type { BankAccount, BankTx, ExpenseCategory, Partner } from "../utils/finance";
import type { Employee } from "../utils/personnel";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

const MATCH = { bg: "#F59E0B", border: "#F59E0B", fg: "#FFFFFF" };
const REMATCH = { bg: "#F0FDF4", border: "#6EE7B7", fg: "#047857" };
const UNMATCH = { bg: "#FFFFFF", border: "#FDA4AF", fg: "#E11D48" };

function flowLabel(type?: string | null): string {
  if (type === "inflow") return "Giriş";
  if (type === "outflow") return "Çıkış";
  if (type === "transfer") return "Virman";
  return "Hareket";
}

function statusLabel(state: ReturnType<typeof txMatchState>): string | null {
  if (state === "rematching") return "Eşleştiriliyor…";
  if (state === "matched") return "eşleşti";
  if (state === "unmatched") return "EŞLEŞME BEKLİYOR";
  return null;
}

function ActionButton({
  label,
  testID,
  onPress,
  palette,
}: {
  label: string;
  testID: string;
  onPress: () => void;
  palette: { bg: string; border: string; fg: string };
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 36,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 8,
        backgroundColor: palette.bg,
        borderColor: palette.border,
      }}
    >
      <Text style={{ color: palette.fg, fontWeight: "800", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function BankTxCard({
  tx,
  account,
  accounts,
  canEdit,
  onChanged,
  onMessage,
  onError,
}: {
  tx: BankTx;
  account?: BankAccount | null;
  accounts: BankAccount[];
  canEdit: boolean;
  onChanged: () => void;
  onMessage?: (message: string) => void;
  onError?: (message: string) => void;
}) {
  const { client, companyId } = useAuth();
  const id = idOf(tx);
  const state = txMatchState(tx);
  const [detail, setDetail] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState<MatchDraft>(emptyMatchDraft(tx));
  const [contactLabel, setContactLabel] = useState(tx.suggested_contact_name || "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [expenseCats, setExpenseCats] = useState<ExpenseCategory[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    if (!matchOpen) return undefined;
    let cancel = false;
    Promise.all([
      get<ExpenseCategory[]>(client, "/expenses/categories", { company_id: companyId }).catch(() => []),
      get<Employee[]>(client, "/personnel/employees", { company_id: companyId }).catch(() => []),
      get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
    ]).then(([cats, emps, pts]) => {
      if (cancel) return;
      setExpenseCats(cats || []);
      setEmployees(emps || []);
      setPartners(pts || []);
    });
    return () => { cancel = true; };
  }, [matchOpen, client, companyId]);

  const inflow = tx.type === "inflow";
  const outflow = tx.type === "outflow";
  const signed = outflow ? "-" : inflow ? "+" : "";
  const amountColor = inflow ? "#059669" : outflow ? "#E11D48" : colors.text;
  const status = statusLabel(state);
  const who = txUserColumnLabel(tx);
  const accountName = account?.account_name || tx.account_name || "Hesap";
  const showActions = canEdit && (state === "unmatched" || state === "matched");

  const openMatch = (replace: boolean) => {
    setReplacing(replace);
    setDraft(replace ? replaceMatchDraft(tx) : emptyMatchDraft(tx));
    setContactLabel(replace ? (tx.contact_name || tx.suggested_contact_name || "") : (tx.suggested_contact_name || ""));
    setFormError(null);
    setDetail(false);
    setMatchOpen(true);
  };

  const closeMatch = () => {
    setMatchOpen(false);
    setFormError(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await submitMatch(client, tx, draft, { replace: replacing });
      setMatchOpen(false);
      onMessage?.(replacing ? "Eşleştirme güncellendi." : "Eşleştirildi.");
      onChanged();
    } catch (err) {
      const message = apiErrorMessage(err, "Eşleştirilemedi.");
      setFormError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  };

  const unmatch = () => {
    confirmAction("Eşleşmeyi geri al", "Eşleşme geri alınsın mı? Cari/fatura/kasa etkileri iptal edilir.", () => {
      unmatchTx(client, tx)
        .then(() => {
          setDetail(false);
          onMessage?.("Eşleşme geri alındı.");
          onChanged();
        })
        .catch((err) => onError?.(apiErrorMessage(err, "Eşleşme geri alınamadı.")));
    });
  };

  const actions = (full: boolean) => {
    if (state === "rematching") {
      return (
        <Text testID={`bank-tx-rematching-${id}`} style={{ color: "#64748B", fontWeight: "800", fontSize: 12 }}>
          Eşleştiriliyor…
        </Text>
      );
    }
    if (!showActions) return null;
    if (state === "unmatched") {
      return (
        <ActionButton
          label="Eşleştir"
          testID={full ? `bank-tx-sheet-match-${id}` : `bank-tx-match-${id}`}
          palette={MATCH}
          onPress={() => openMatch(false)}
        />
      );
    }
    return (
      <>
        <ActionButton
          label={full ? "Eşleştirmeyi değiştir" : "Değiştir"}
          testID={full ? `bank-tx-sheet-rematch-${id}` : `bank-tx-rematch-${id}`}
          palette={REMATCH}
          onPress={() => openMatch(true)}
        />
        <ActionButton
          label={full ? "Eşleştirmeyi kaldır" : "Kaldır"}
          testID={full ? `bank-tx-sheet-unmatch-${id}` : `bank-tx-unmatch-${id}`}
          palette={UNMATCH}
          onPress={unmatch}
        />
      </>
    );
  };

  return (
    <View
      style={{
        backgroundColor: "#fff",
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        gap: 8,
      }}
    >
      <Pressable testID={`bank-tx-row-${id}`} onPress={() => setDetail(true)} style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {tx.category ? (
            <View style={{ backgroundColor: colors.slate100, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10, fontWeight: "800", color: colors.text }}>{tx.category}</Text>
            </View>
          ) : null}
          {status ? (
            <Text style={{ fontSize: 10, fontWeight: "800", color: state === "rematching" ? "#64748B" : state === "matched" ? "#047857" : "#B45309" }}>
              {status}
            </Text>
          ) : null}
          <Text style={{ marginLeft: "auto", fontWeight: "800", color: amountColor }}>
            {signed}{fmtMoney(tx.amount, tx.currency)}
          </Text>
        </View>
        <Text numberOfLines={2} style={{ fontWeight: "700", color: colors.text }}>{tx.description || "Hareket"}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{[fmtDate(tx.date), who].filter(Boolean).join(" · ")}</Text>
      </Pressable>
      {showActions || state === "rematching" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>{actions(false)}</View>
      ) : null}

      <B2BSheet visible={detail} title="Hareket detayı" onClose={() => setDetail(false)} testID="bank-tx-sheet">
        <Text style={{ fontSize: 28, fontWeight: "800", color: amountColor }}>{signed}{fmtMoney(tx.amount, tx.currency)}</Text>
        <Text style={{ color: colors.muted, marginTop: 4 }}>
          {[fmtDate(tx.date), flowLabel(tx.type), accountName].join(" · ")}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
          <View style={{ backgroundColor: colors.slate100, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>{tx.category || flowLabel(tx.type)}</Text>
          </View>
          {status ? <Text style={{ fontSize: 11, fontWeight: "800", color: state === "rematching" ? "#64748B" : colors.text }}>{status}</Text> : null}
        </View>
        <Text testID={`bank-tx-sheet-desc-${id}`} style={{ marginTop: 10, color: colors.text, fontSize: 15 }}>{tx.description || ""}</Text>
        <Text style={{ marginTop: 10, color: colors.muted }}>Oluşturan: {txCreatedSourceLabel(tx) || "—"}</Text>
        <Text style={{ color: colors.muted }}>Eşleştiren: {sanitizeActorLabel(tx.matched_by_name) || "—"}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>{actions(true)}</View>
      </B2BSheet>

      <B2BSheet
        visible={matchOpen}
        title={replacing ? "Eşleştirmeyi değiştir" : "Hareketi eşleştir"}
        subtitle={`${tx.description || ""} · ${signed}${fmtMoney(tx.amount, tx.currency)}`}
        onClose={closeMatch}
        testID="bank-match-sheet"
      >
        <BankMatchForm
          tx={tx}
          draft={draft}
          setDraft={setDraft}
          contactLabel={contactLabel}
          setContactLabel={setContactLabel}
          accounts={accounts}
          partners={partners}
          expenseCats={expenseCats}
          employees={employees}
          busy={saving}
          error={formError}
          onSubmit={save}
          onCancel={closeMatch}
          replace={replacing}
        />
      </B2BSheet>
    </View>
  );
}
