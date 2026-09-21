import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ActionTiles } from "../components/ActionTiles";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { Chip, confirmAction } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Badge, Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row } from "../components/kit";
import { colors } from "../theme";
import type { Contact, Invoice } from "../types";
import {
  MATCH_MODES,
  canSubmitMatch,
  connStatusTone,
  connStatusTr,
  contactSelectGroups,
  emptyMatchDraft,
  invoiceSelectGroups,
  matchPayload,
  matchResultLabel,
  matchTargets,
  matchedViaTr,
  openInvoices,
  ruleLabel,
  suggestionLabel,
  transferSelectGroups,
  type BankConnection,
  type BankMatchTx,
  type MatchDraft,
  type MatchRule,
  type MatchSuggestion,
} from "../utils/bankMatch";
import type { BankAccount, Partner } from "../utils/finance";
import { fmtDate, fmtMoney, idOf } from "../utils/money";

export function BankingMatchPanel({
  accounts,
  onChanged,
}: {
  accounts: BankAccount[];
  onChanged: () => void;
}) {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [unmatched, setUnmatched] = useState<BankMatchTx[]>([]);
  const [matched, setMatched] = useState<BankMatchTx[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
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
  const [partners, setPartners] = useState<Partner[]>([]);

  const load = useCallback(async () => {
    try {
      const [conn, um, mt, ct, inv, rl, sg, pt] = await Promise.all([
        get<BankConnection[]>(client, "/banking/connections", { company_id: companyId }).catch(() => []),
        get<BankMatchTx[]>(client, "/banking/transactions/unmatched", { company_id: companyId }).catch(() => []),
        get<BankMatchTx[]>(client, "/banking/transactions/matched", { company_id: companyId, limit: 50 }).catch(() => []),
        get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true }).catch(() => []),
        get<Invoice[]>(client, "/invoices", { company_id: companyId }).catch(() => []),
        get<MatchRule[]>(client, "/banking/match-rules", { company_id: companyId }).catch(() => []),
        get<MatchSuggestion[]>(client, "/banking/match-rule-suggestions", { company_id: companyId }).catch(() => []),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
      ]);
      setConnections(conn || []);
      setUnmatched(um || []);
      setMatched(mt || []);
      setContacts(ct || []);
      setInvoices(inv || []);
      setRules(rl || []);
      setSuggestions(sg || []);
      setPartners(pt || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Eşleşme verileri yüklenemedi."));
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  const openMatch = (tx: BankMatchTx) => {
    setActive(tx);
    setDraft(emptyMatchDraft(tx));
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
    run("match", async () => {
      await post(client, `/banking/transactions/${idOf(active)}/match`, matchPayload(draft));
      setActive(null);
      setMessage(draft.learn ? "Eşleştirildi ve kural olarak öğrenildi." : "Eşleştirildi.");
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

  const openInv = useMemo(
    () => (active ? openInvoices(invoices, draft.contact_id, active) : []),
    [active, invoices, draft.contact_id]
  );
  const targets = useMemo(
    () => (active ? matchTargets(accounts, active) : []),
    [active, accounts]
  );
  const cashTargets = useMemo(() => (accounts || []).filter((a) => !a.is_integrated), [accounts]);

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
        <Text style={{ fontWeight: "800", color: colors.text }}>Hareketleri çekip cari / fatura / kasa ile eşleştirin</Text>
        <Muted>Banka bağlama ve API anahtarları web’den yönetilir. Burada senkron ve eşleşme yapılır.</Muted>
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
              subtitle={[fmtDate(t.date), matchResultLabel(t), matchedViaTr(t.matched_via)].filter(Boolean).join(" · ")}
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
              <GroupedSelect label="Cari (ops.)" testID="rule-contact-select" value={newRule.contact_id} onChange={(v) => setNewRule({ ...newRule, contact_id: v })} groups={contactSelectGroups(contacts)} emptyLabel="Cari (opsiyonel)" />
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
      ) : unmatched.map((t) => {
        const id = idOf(t);
        const inflow = t.type === "inflow";
        return (
          <ListRow
            key={id}
            testID={`unmatched-tx-${id}`}
            title={t.description || "Hareket"}
            subtitle={[fmtDate(t.date), t.account_name, t.is_simulated ? "SİMÜLE" : "", t.suggested_contact_name ? `Öneri: ${t.suggested_contact_name}` : ""].filter(Boolean).join(" · ")}
            right={`${inflow ? "+" : "-"}${fmtMoney(t.amount)}`}
            rightSub="Eşleştir"
            rightSubColor={colors.indigo}
            onPress={canEdit ? () => openMatch(t) : undefined}
          />
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
              {MATCH_MODES.map((m) => (
                <Chip
                  key={m.key}
                  label={m.label}
                  active={draft.mode === m.key}
                  testID={`match-mode-${m.key}`}
                  onPress={() => setDraft({ ...draft, mode: m.key, invoice_id: m.key === "invoice" ? draft.invoice_id : "" })}
                />
              ))}
            </Row>
            {draft.mode === "contact" || draft.mode === "invoice" ? (
              <GroupedSelect
                label="Cari"
                testID={`match-contact-select-${idOf(active)}`}
                value={draft.contact_id}
                onChange={(v) => setDraft({ ...draft, contact_id: v, invoice_id: "" })}
                groups={contactSelectGroups(contacts, active.suggested_contact_id)}
                emptyLabel={draft.mode === "contact" ? "Cari seçin (boş = sadece onayla)" : "Cari seçin"}
              />
            ) : null}
            {draft.mode === "invoice" ? (
              <GroupedSelect
                label="Açık fatura"
                testID={`match-invoice-select-${idOf(active)}`}
                value={draft.invoice_id}
                onChange={(v) => setDraft({ ...draft, invoice_id: v })}
                groups={invoiceSelectGroups(openInv)}
                emptyLabel={!draft.contact_id ? "Önce cari seçin" : openInv.length ? "Açık fatura seçin" : "Açık fatura yok"}
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
            <Field
              label={draft.mode === "category" ? "Kategori (zorunlu)" : "Kategori (ops.)"}
              testID={`match-category-${idOf(active)}`}
              value={draft.category}
              onChangeText={(v) => setDraft({ ...draft, category: v })}
              placeholder={draft.mode === "category" ? "Kategori" : "Kategori (ops.)"}
            />
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
