import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { Chip, confirmAction } from "../components/chips";
import { ContactSearchSelect } from "../components/ContactSearchSelect";
import { GroupedSelect } from "../components/GroupedSelect";
import { Badge, Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row } from "../components/kit";
import { colors } from "../theme";
import {
  canSubmitMatch,
  connStatusTone,
  connStatusTr,
  DEFAULT_PERSONNEL_PAY_KIND,
  employeeSelectGroups,
  emptyMatchDraft,
  isPersonnelExpenseCategory,
  matchExpenseCategoryGroups,
  matchModesForTx,
  matchPayload,
  matchResultLabel,
  matchTargets,
  matchedViaTr,
  PERSONNEL_EXPENSE_CATEGORY,
  PERSONNEL_PAY_KINDS,
  personnelCategoryOnly,
  personnelPayKindGroups,
  ruleLabel,
  suggestionLabel,
  transferSelectGroups,
  type BankConnection,
  type BankMatchTx,
  type MatchDraft,
  type MatchRule,
  type MatchSuggestion,
  type PersonnelPayKind,
} from "../utils/bankMatch";
import { txUserColumnLabel } from "../utils/bankMatchLabel";
import type { BankAccount, ExpenseCategory, Partner } from "../utils/finance";
import { expensePersonnelDebtOpen, type Employee } from "../utils/personnel";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

function openDebtOptionLabel(exp: Record<string, unknown>): string {
  const num = String(exp.expense_number || exp.number || "MSR");
  const date = fmtDate(exp.date ? String(exp.date) : "");
  const amount = exp.personnel_debt_amount ?? exp.total ?? exp.amount;
  return `${num} · ${date} · ${fmtMoney(amount)}`;
}

export function BankingMatchPanel({
  accounts,
  onChanged,
  focusAccountId = "",
  focusTxId = "",
}: {
  accounts: BankAccount[];
  onChanged: () => void;
  focusAccountId?: string;
  focusTxId?: string;
}) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [unmatched, setUnmatched] = useState<BankMatchTx[]>([]);
  const [matched, setMatched] = useState<BankMatchTx[]>([]);
  const [expenseCats, setExpenseCats] = useState<ExpenseCategory[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rules, setRules] = useState<MatchRule[]>([]);
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showMatched, setShowMatched] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [active, setActive] = useState<BankMatchTx | null>(null);
  const [draft, setDraft] = useState<MatchDraft>(emptyMatchDraft());
  const [newRule, setNewRule] = useState({ pattern: "", contact_id: "", category: "", target_account_id: "" });
  const [ruleContactLabel, setRuleContactLabel] = useState("");
  const [contactLabel, setContactLabel] = useState("");
  const [partners, setPartners] = useState<Partner[]>([]);
  const [openDebts, setOpenDebts] = useState<Record<string, unknown>[]>([]);
  const [debtsReady, setDebtsReady] = useState(false);
  const [ready, setReady] = useState(false);
  const openedFocus = React.useRef("");

  const load = useCallback(async () => {
    try {
      const [conn, um, mt, cats, emps, rl, sg, pt] = await Promise.all([
        get<BankConnection[]>(client, "/banking/connections", { company_id: companyId }).catch(() => []),
        get<BankMatchTx[]>(client, "/banking/transactions/unmatched", { company_id: companyId }).catch(() => []),
        get<BankMatchTx[]>(client, "/banking/transactions/matched", { company_id: companyId, limit: 50 }).catch(() => []),
        get<ExpenseCategory[]>(client, "/expenses/categories", { company_id: companyId }).catch(() => []),
        get<Employee[]>(client, "/personnel/employees", { company_id: companyId }).catch(() => []),
        get<MatchRule[]>(client, "/banking/match-rules", { company_id: companyId }).catch(() => []),
        get<MatchSuggestion[]>(client, "/banking/match-rule-suggestions", { company_id: companyId }).catch(() => []),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
      ]);
      setConnections(conn || []);
      setUnmatched(um || []);
      setMatched(mt || []);
      setExpenseCats(cats || []);
      setEmployees(emps || []);
      setRules(rl || []);
      setSuggestions(sg || []);
      setPartners(pt || []);
      setReady(true);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Eşleşme verileri yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

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

  useEffect(() => {
    if (!ready || !focusTxId || openedFocus.current === focusTxId) return;
    const hit = unmatched.find((t) => idOf(t) === focusTxId);
    if (hit) {
      openedFocus.current = focusTxId;
      openMatch(hit);
      return;
    }
    openedFocus.current = focusTxId;
    setError("Kayıt bulunamadı");
  }, [ready, focusTxId, unmatched]);

  const openMatch = (tx: BankMatchTx) => {
    setActive(tx);
    setDraft(emptyMatchDraft(tx));
    setContactLabel(tx.suggested_contact_name || "");
  };

  const run = async (key: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) setMessage(ok);
      await load();
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem yapılamadı."));
    } finally {
      setBusy(null);
    }
  };

  const syncOne = (id: string) => run(`sync-${id}`, async () => {
    const r = await post<{ message?: string }>(client, `/banking/connections/${id}/sync`, {});
    setMessage(r?.message || "Hareketler çekildi.");
  });

  const syncAll = () => run("sync-all", async () => {
    const r = await post<{ results?: unknown[] }>(client, "/banking/sync-all", {}, { company_id: companyId });
    setMessage(`${(r?.results || []).length} bağlantı senkronize edildi.`);
  });

  const toggleAutoSync = (c: BankConnection) => run(`sync-toggle-${idOf(c)}`, async () => {
    const turningOn = c.auto_sync === false;
    await put(client, `/banking/connections/${idOf(c)}`, { auto_sync: turningOn });
    setMessage(turningOn
      ? "Arka plan senkronu açık: sunucu her 2 dakikada hareketleri çeker; yeni hareket telefona push gider."
      : "Arka plan senkronu kapalı: yalnızca manuel çekim çalışır.");
  });

  const toggleAuto = (c: BankConnection) => run(`auto-${idOf(c)}`, async () => {
    const r = await put<{ message?: string }>(client, `/banking/connections/${idOf(c)}`, { auto_match: !c.auto_match });
    setMessage(!c.auto_match
      ? (r?.message || "Otomatik işleme aktif: önceki eşleşme veya cari adı varsa hareket işlenir.")
      : "Otomatik işleme pasif: hareketler manuel eşleşme bekleyecek.");
  });

  const autoMatch = (useSuggestions: boolean) => run(useSuggestions ? "auto-sug" : "auto", async () => {
    const r = await post<{ message?: string; matched?: number }>(
      client,
      "/banking/transactions/auto-match",
      {},
      { company_id: companyId, use_suggestions: useSuggestions }
    );
    setMessage(r?.message || "Otomatik eşleşme tamamlandı.");
  });

  const submitMatch = () => {
    if (!active || !canSubmitMatch(draft)) return;
    const personnel = draft.mode === "expense" && isPersonnelExpenseCategory(draft.category);
    const employee = employees.find((e) => idOf(e) === draft.employee_id) as { full_name?: string; name?: string } | undefined;
    const employeeName = employee?.full_name || employee?.name || "";
    const kindLabel = PERSONNEL_PAY_KINDS.find((k) => k.key === draft.personnel_pay_kind)?.label || "";
    run("match", async () => {
      await post(client, `/banking/transactions/${idOf(active)}/match`, matchPayload(draft));
      setActive(null);
      if (personnel) {
        const learned = draft.learn ? " ve kural olarak öğrenildi" : "";
        setMessage(`${employeeName} · ${kindLabel} eşleştirildi${learned}.`);
      } else {
        setMessage(draft.learn ? "Eşleştirildi ve kural olarak öğrenildi." : "Eşleştirildi.");
      }
    });
  };

  const unmatch = (tx: BankMatchTx) => {
    confirmAction("Eşleşmeyi geri al", "Eşleşme geri alınsın mı? Cari/fatura/kasa etkileri iptal edilir.", () => {
      run(`unmatch-${idOf(tx)}`, async () => {
        await post(client, `/banking/transactions/${idOf(tx)}/unmatch`, {});
        setMessage("Eşleşme geri alındı.");
      });
    });
  };

  const acceptSuggestion = (sg: MatchSuggestion) => run(`sg-${sg.pattern}`, async () => {
    const r = await post<{ message?: string }>(client, "/banking/match-rule-suggestions/accept", {
      company_id: companyId,
      pattern: sg.pattern,
      contact_id: sg.contact_id,
      target_account_id: sg.target_account_id,
      category: sg.category,
      apply_now: true,
    });
    setMessage(r?.message || "Kural oluşturuldu.");
  });

  const addRule = () => {
    if (!newRule.pattern.trim()) { setError("Kural için anahtar kelime girin."); return; }
    run("add-rule", async () => {
      await post(client, "/banking/match-rules", {
        company_id: companyId,
        pattern: newRule.pattern.trim(),
        contact_id: newRule.contact_id || null,
        category: newRule.category.trim() || null,
        target_account_id: newRule.target_account_id || null,
      });
      setNewRule({ pattern: "", contact_id: "", category: "", target_account_id: "" });
      setMessage("Kural eklendi.");
    });
  };

  const deleteRule = (id: string) => run(`del-rule-${id}`, async () => {
    await del(client, `/banking/match-rules/${id}`);
  });

  const targets = useMemo(
    () => (active ? matchTargets(accounts, active) : []),
    [active, accounts]
  );
  const cashTargets = useMemo(() => (accounts || []).filter((a) => !a.is_integrated), [accounts]);
  const needPersonnel = draft.mode === "expense" && isPersonnelExpenseCategory(draft.category);
  const expenseCatGroups = useMemo(() => matchExpenseCategoryGroups(expenseCats), [expenseCats]);
  const employeeGroups = useMemo(() => employeeSelectGroups(employees), [employees]);
  const openDebtGroups = useMemo(() => {
    const options = openDebts
      .map((exp) => ({ value: idOf(exp), label: openDebtOptionLabel(exp) }))
      .filter((o) => o.value);
    return options.length ? [{ label: "Açık masraf borçları", options }] : [];
  }, [openDebts]);

  const tiles = [
    canEdit && connections.length ? { key: "sync", label: "Tümünü senkronize", icon: "sync" as const, tone: "indigo" as const, testID: "sync-all-btn", busy: busy === "sync-all", onPress: syncAll } : null,
    canEdit && unmatched.length ? { key: "auto", label: "Otomatik işle", icon: "flash" as const, tone: "violet" as const, testID: "auto-match-btn", busy: busy === "auto", onPress: () => autoMatch(false) } : null,
    canEdit && unmatched.length ? { key: "sug", label: "Önerileri uygula", icon: "sparkles" as const, tone: "violet" as const, testID: "auto-match-suggestions-btn", busy: busy === "auto-sug", onPress: () => autoMatch(true) } : null,
    { key: "rules", label: `Kurallar (${rules.length})`, icon: "settings" as const, tone: "slate" as const, testID: "toggle-rules-btn", onPress: () => setShowRules((v) => !v) },
    { key: "matched", label: `Eşleşenler (${matched.length})`, icon: "checkmark-circle" as const, tone: "emerald" as const, testID: "toggle-matched-btn", onPress: () => setShowMatched((v) => !v) },
  ].filter(Boolean);

  return (
    <View style={{ gap: 10 }} testID="bank-match-panel">
      <ErrorBanner message={error} />
      {message ? <Muted testID="bank-match-msg">{message}</Muted> : null}

      <Card>
        <Muted>Bağlı bankalar</Muted>
        <Text style={{ fontWeight: "800", color: colors.text }}>Hareketleri çekip cari / kasa / masraf ile eşleştirin</Text>
        <Muted>Kimlik bilgisi olan bağlantılar sunucuda her 2 dakikada arka planda çekilir; yeni hareket uygulama kapalıyken de push olarak gelir. Banka bağlama ve API anahtarları web’den yönetilir.</Muted>
      </Card>

      {tiles.length ? <ActionTiles items={tiles as never} /> : null}

      {!connections.length ? (
        <Empty icon="link-outline" title="Banka bağlantısı yok" hint="Web’den Kasa & Banka → Banka bağla ile Enpara / Kuveyt bağlayın." />
      ) : connections.map((c) => {
        const id = idOf(c);
        return (
          <Card key={id} testID={`bank-conn-card-${id}`}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "800", color: colors.text }}>{c.provider_name || c.provider}</Text>
                <Muted>→ {c.linked_account_name || "Hesap"}</Muted>
              </View>
              <Badge label={connStatusTr(c.status)} tone={connStatusTone(c.status)} />
            </Row>
            <Muted>Son senk: {c.last_synced_at ? fmtDate(c.last_synced_at) : "—"} · çekilen {c.synced_count || 0}</Muted>
            {c.last_error ? <Text style={{ color: colors.danger, fontSize: 12 }}>{c.last_error}</Text> : null}
            {canEdit ? (
              <Pressable
                testID={`auto-sync-toggle-${id}`}
                onPress={() => toggleAutoSync(c)}
                style={{
                  marginTop: 4,
                  padding: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.auto_sync === false ? colors.border : "#7DD3FC",
                  backgroundColor: c.auto_sync === false ? colors.slate50 : "#F0F9FF",
                }}
              >
                <Text style={{ fontWeight: "800", color: c.auto_sync === false ? colors.text : "#075985" }}>
                  Arka plan senkron {c.auto_sync === false ? "kapalı" : "açık"}
                </Text>
                <Muted>Kimlik bilgisi varsa her 2 dakikada otomatik çekilir</Muted>
              </Pressable>
            ) : null}
            {canEdit ? (
              <Pressable
                testID={`auto-match-toggle-${id}`}
                onPress={() => toggleAuto(c)}
                style={{
                  marginTop: 4,
                  padding: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: c.auto_match ? "#C4B5FD" : colors.border,
                  backgroundColor: c.auto_match ? "#F5F3FF" : colors.slate50,
                }}
              >
                <Text style={{ fontWeight: "800", color: c.auto_match ? "#5B21B6" : colors.text }}>
                  Otomatik işle {c.auto_match ? "açık" : "kapalı"}
                </Text>
                <Muted>Önceki eşleşme veya cari adı varsa otomatik işle{c.auto_matched_count ? ` (${c.auto_matched_count} işlendi)` : ""}</Muted>
              </Pressable>
            ) : null}
            {canEdit ? (
              <PrimaryButton
                title="Hareketleri çek"
                testID={`sync-conn-btn-${id}`}
                loading={busy === `sync-${id}`}
                color={colors.indigo}
                onPress={() => syncOne(id)}
              />
            ) : null}
          </Card>
        );
      })}

      {showMatched ? (
        <Card testID="matched-list">
          <Text style={{ fontWeight: "800", color: colors.text }}>Son eşleşenler</Text>
          {!matched.length ? <Muted>Henüz eşleştirilmiş hareket yok.</Muted> : matched.map((t) => (
            <ListRow
              key={idOf(t)}
              testID={`matched-tx-${idOf(t)}`}
              title={t.description || "Hareket"}
              subtitle={[
                fmtDate(t.date),
                matchResultLabel(t),
                matchedViaTr(t.matched_via),
                txUserColumnLabel({ ...t, match_status: "matched" }),
              ].filter(Boolean).join(" · ")}
              right={`${t.type === "inflow" ? "+" : "-"}${fmtMoney(t.amount)}`}
              rightSub={canEdit ? "Geri al" : undefined}
              onPress={canEdit ? () => unmatch(t) : undefined}
            />
          ))}
        </Card>
      ) : null}

      {suggestions.length ? (
        <Card testID="rule-suggestions">
          <Text style={{ fontWeight: "800", color: colors.text }}>{suggestions.length} kural önerisi</Text>
          {suggestions.map((sg) => (
            <View key={sg.pattern} testID={`rule-suggestion-${String(sg.pattern || "").replace(/\s+/g, "-")}`} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 }}>
              <Text style={{ fontWeight: "700", color: colors.text }}>{`"${sg.pattern}"`}</Text>
              <Muted>{sg.count}× → {suggestionLabel(sg)}{sg.consistent === false ? " · farklı eşleşmeler var" : ""}</Muted>
              {canEdit ? (
                <PrimaryButton
                  title="Kural yap"
                  color="#7C3AED"
                  testID={`rule-suggestion-accept-${String(sg.pattern || "").replace(/\s+/g, "-")}`}
                  onPress={() => acceptSuggestion(sg)}
                />
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      {showRules ? (
        <Card testID="match-rules-panel">
          <Text style={{ fontWeight: "800", color: colors.text }}>Eşleşme kuralları</Text>
          <Muted>Manuel eşleştirme otomatik kural olarak öğrenilir. İsterseniz anahtar kelime ekleyin.</Muted>
          {canEdit ? (
            <>
              <Field label="Anahtar kelime" testID="rule-pattern-input" value={newRule.pattern} onChangeText={(v) => setNewRule({ ...newRule, pattern: v })} placeholder="örn: trendyol" />
              <ContactSearchSelect
                label="Cari (ops.)"
                testID="rule-contact-select"
                value={newRule.contact_id}
                valueLabel={ruleContactLabel}
                onChange={(id, c) => { setNewRule({ ...newRule, contact_id: id }); setRuleContactLabel(c?.name || ""); }}
                emptyLabel="Cari (opsiyonel)"
                placeholder="Cari adı, ünvan, VKN, telefon veya cari kodu"
              />
              <Field label="Kategori (ops.)" testID="rule-category-input" value={newRule.category} onChangeText={(v) => setNewRule({ ...newRule, category: v })} placeholder="Pazaryeri hakediş" />
              <GroupedSelect label="Kasa / virman (ops.)" testID="rule-target-select" value={newRule.target_account_id} onChange={(v) => setNewRule({ ...newRule, target_account_id: v })} groups={transferSelectGroups(cashTargets, partners)} emptyLabel="Kasa/hesap virman (ops.)" />
              <PrimaryButton title="Kural ekle" testID="add-rule-btn" color="#7C3AED" onPress={addRule} />
            </>
          ) : null}
          {rules.map((r) => (
            <Row key={idOf(r)} style={{ justifyContent: "space-between", paddingVertical: 6 }}>
              <Text style={{ flex: 1, fontSize: 12, fontWeight: "700", color: colors.text }} testID={`rule-chip-${idOf(r)}`}>
                {ruleLabel(r)} · {r.hits || 0}x
              </Text>
              {canEdit ? (
                <Pressable onPress={() => deleteRule(idOf(r))} testID={`rule-delete-${idOf(r)}`}>
                  <Text style={{ color: colors.danger, fontWeight: "700" }}>Sil</Text>
                </Pressable>
              ) : null}
            </Row>
          ))}
          {!rules.length ? <Muted>Henüz öğrenilmiş kural yok.</Muted> : null}
        </Card>
      ) : null}

      <Text style={{ fontWeight: "800", color: colors.text }} testID="unmatched-heading">
        Eşleşme bekleyen hareketler ({unmatched.length})
      </Text>
      {!unmatched.length ? (
        <Empty icon="checkmark-done-outline" title="Eşleştirme bekleyen hareket yok" />
      ) : unmatched.filter((t) => !focusAccountId || String(t.account_id || "") === focusAccountId || idOf(t) === focusTxId).map((t) => {
        const id = idOf(t);
        const inflow = t.type === "inflow";
        return (
          <View key={id} style={id === focusTxId ? { borderWidth: 2, borderColor: "#f59e0b", borderRadius: 16 } : undefined}>
          <ListRow
            testID={`unmatched-tx-${id}`}
            title={t.description || "Hareket"}
            subtitle={[fmtDate(t.date), t.account_name, t.is_simulated ? "SİMÜLE" : "", t.suggested_contact_name ? `Öneri: ${t.suggested_contact_name}` : ""].filter(Boolean).join(" · ")}
            right={`${inflow ? "+" : "-"}${fmtMoney(t.amount)}`}
            rightSub="Eşleştir"
            rightSubColor={colors.indigo}
            onPress={canEdit ? () => openMatch(t) : undefined}
          />
          </View>
        );
      })}

      <B2BSheet
        visible={!!active}
        title="Hareketi eşleştir"
        subtitle={active ? `${active.description || ""} · ${active.type === "inflow" ? "+" : "-"}${fmtMoney(active.amount)}` : undefined}
        onClose={() => setActive(null)}
        testID="bank-match-sheet"
      >
        {active ? (
          <View>
            {active.suggested_contact_name ? <Muted>Öneri: {active.suggested_contact_name}</Muted> : null}
            <Row style={{ flexWrap: "wrap" }}>
              {matchModesForTx(active).map((m) => (
                <Chip
                  key={m.key}
                  label={m.label}
                  active={draft.mode === m.key}
                  testID={`match-mode-${m.key}`}
                  onPress={() => setDraft((d) => ({
                    ...d,
                    mode: m.key,
                    contact_id: m.key === "contact" ? (d.contact_id || active.suggested_contact_id || "") : "",
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
                testID={`match-contact-select-${idOf(active)}`}
                value={draft.contact_id}
                valueLabel={contactLabel}
                onChange={(id, c) => { setDraft({ ...draft, contact_id: id }); setContactLabel(c?.name || ""); }}
                emptyLabel="Cari seçin (boş = sadece onayla)"
                placeholder="Cari adı, ünvan, VKN, telefon veya cari kodu"
                suggestText={active.description || ""}
                counterparty={active.counterparty || active.suggested_contact_name || ""}
              />
            ) : null}
            {draft.mode === "transfer" ? (
              <GroupedSelect
                label={active.type === "inflow" ? "Para nereden geldi?" : "Para nereye gitti?"}
                testID={`match-target-select-${idOf(active)}`}
                value={draft.target_account_id}
                onChange={(v) => setDraft({ ...draft, target_account_id: v })}
                groups={transferSelectGroups(targets, partners)}
                emptyLabel={active.type === "inflow" ? "Para nereden geldi?" : "Para nereye gitti?"}
              />
            ) : null}
            {draft.mode === "category" ? (
              <>
                <Field
                  label="Kategori (zorunlu)"
                  testID={`match-category-${idOf(active)}`}
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
                    testID={`match-personnel-warn-${idOf(active)}`}
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
                      testID={`match-goto-expense-${idOf(active)}`}
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
                testID={`match-expense-cat-${idOf(active)}`}
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
                  testID={`match-pay-kind-${idOf(active)}`}
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
                  <Muted testID={`match-expense-note-${idOf(active)}`}>Personel bakiyesini değiştirmez.</Muted>
                ) : null}
                <GroupedSelect
                  label="Personel (zorunlu)"
                  testID={`match-employee-${idOf(active)}`}
                  value={draft.employee_id}
                  onChange={(v) => setDraft({ ...draft, employee_id: v, expense_id: "" })}
                  groups={employeeGroups}
                  emptyLabel="Personel seçin…"
                />
                {draft.personnel_pay_kind === "reimburse" && draft.employee_id ? (
                  <>
                    <GroupedSelect
                      label="Açık masraf borcu (isteğe bağlı)"
                      testID={`match-msr-${idOf(active)}`}
                      value={draft.expense_id || ""}
                      onChange={(v) => setDraft({ ...draft, expense_id: v })}
                      groups={openDebtGroups}
                      emptyLabel="Otomatik (en eski açık borçlar)"
                    />
                    {debtsReady && !openDebts.length ? (
                      <Muted testID={`match-msr-empty-${idOf(active)}`}>
                        Açık masraf borcu görünmüyor; kaydederseniz sunucu uyarı verebilir.
                      </Muted>
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}
            <Chip
              label={draft.learn ? "Öğren: açık" : "Öğren: kapalı"}
              active={draft.learn}
              testID={`match-learn-${idOf(active)}`}
              color="#7C3AED"
              onPress={() => setDraft({ ...draft, learn: !draft.learn })}
            />
            <PrimaryButton
              title="Eşleştir"
              testID={`match-btn-${idOf(active)}`}
              color={colors.primary}
              disabled={!canSubmitMatch(draft)}
              loading={busy === "match"}
              onPress={submitMatch}
            />
          </View>
        ) : null}
      </B2BSheet>
    </View>
  );
}
