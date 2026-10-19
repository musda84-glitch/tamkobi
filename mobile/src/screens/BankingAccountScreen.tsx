import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { BankMark } from "../components/BankMark";
import { BankTxCard } from "../components/BankTxCard";
import { Chip, confirmAction, n } from "../components/chips";
import { ContactSearchSelect } from "../components/ContactSearchSelect";
import { MoneyInput } from "../components/MoneyInput";
import { Card, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { resolveBankBrand } from "../utils/bankBrand";
import { accountBalance, accountCashTxRequest, accountMaskedRef, accountTypeTr, normalizeAccountType, type BankAccount, type BankTx } from "../utils/finance";
import { fmtMoney, idOf, todayIso } from "../utils/money";

type TxFilter = "all" | "in" | "out" | "unmatched";
type DetailStatus = "loading" | "ready" | "notfound" | "error";
type TxStatus = "loading" | "ready" | "error" | "loadingMore";

type TxPageBody = {
  items?: BankTx[];
  total?: number;
  has_more?: boolean;
  page?: number;
};

type TxRetry = { page: number; mode: "replace" | "append" };

const REQUEST_TIMEOUT_MS = 20_000;
const TX_PAGE_SIZE = 50;

class RequestTimeoutError extends Error {
  constructor() {
    super("");
    this.name = "RequestTimeoutError";
  }
}

/** Yalnız bu ekranın istekleri. client.ts zaman aşımı diğer ekranlara yayılmaz. */
function withTimeout<T>(promise: Promise<T>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
  const task = Promise.resolve(promise);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestTimeoutError()), ms);
  });
  void task.catch(() => undefined);
  return Promise.race([task, timed]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function screenErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof RequestTimeoutError) return fallback;
  return apiErrorMessage(err, fallback);
}

function txListQuery(page: number, filter: TxFilter): { page_size: number; page: number; type?: string; matched?: string } {
  const query: { page_size: number; page: number; type?: string; matched?: string } = { page_size: TX_PAGE_SIZE, page };
  if (filter === "in") query.type = "inflow";
  else if (filter === "out") query.type = "outflow";
  else if (filter === "unmatched") query.matched = "no";
  return query;
}

function mergeTxRows(prev: BankTx[], extra: BankTx[]): BankTx[] {
  const seen = new Set(prev.map((tx) => idOf(tx)).filter(Boolean));
  const next = prev.slice();
  for (const tx of extra) {
    const key = idOf(tx);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    next.push(tx);
  }
  return next;
}

function settle<T>(promise: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; err: unknown }> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (err: unknown) => ({ ok: false, err }),
  );
}

function relativeSyncLabel(iso?: string | null, now = new Date()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now.getTime() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} gün önce`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} ay önce`;
  return `${Math.floor(mo / 12)} yıl önce`;
}

function monthText(value: number | null | undefined, currency?: string): string {
  if (value == null) return "—";
  return fmtMoney(value, currency);
}

function routeParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").trim();
}

export function BankingAccountScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/banking", "edit");
  const canExp = can("/expenses", "edit");
  const params = useLocalSearchParams<{ id?: string | string[]; name?: string | string[] }>();
  const accountId = routeParam(params.id);
  const routeName = routeParam(params.name);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [acc, setAcc] = useState<BankAccount | null>(null);
  const [status, setStatus] = useState<DetailStatus>("loading");
  const [txs, setTxs] = useState<BankTx[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [txStatus, setTxStatus] = useState<TxStatus>("loading");
  const [txError, setTxError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TxFilter>("all");
  const [menu, setMenu] = useState(false);
  const [txType, setTxType] = useState<"inflow" | "outflow">("inflow");
  const [amount, setAmount] = useState<string | number>("");
  const [desc, setDesc] = useState("");
  const [contactId, setContactId] = useState("");
  const [contactName, setContactName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const accRef = useRef<BankAccount | null>(null);
  const filterRef = useRef<TxFilter>("all");
  const pageRef = useRef(1);
  const accountGen = useRef(0);
  const txGen = useRef(0);
  const txBusy = useRef(false);
  const txRetryRef = useRef<TxRetry>({ page: 1, mode: "replace" });

  const applyTxBody = useCallback((body: TxPageBody | null | undefined, mode: "replace" | "append", page: number) => {
    const items = Array.isArray(body?.items) ? body.items : [];
    setTxs((prev) => (mode === "append" ? mergeTxRows(prev, items) : mergeTxRows([], items)));
    setTxTotal(Number(body?.total) || 0);
    setHasMore(Boolean(body?.has_more));
    pageRef.current = Number(body?.page) || page;
    setTxStatus("ready");
    setTxError(null);
  }, []);

  const pullTx = useCallback((page: number, nextFilter: TxFilter) => {
    return withTimeout(get<TxPageBody>(
      client,
      `/banking/accounts/${encodeURIComponent(accountId)}/transactions`,
      txListQuery(page, nextFilter),
    ));
  }, [accountId, client]);

  const loadTx = useCallback(async (page: number, mode: "replace" | "append") => {
    if (!accountId) return;
    if (mode === "append" && txBusy.current) return;
    const myTx = mode === "append" ? txGen.current : ++txGen.current;
    txBusy.current = true;
    if (mode === "replace") {
      setTxStatus("loading");
      setTxError(null);
      setHasMore(false);
      setTxs([]);
      setTxTotal(0);
    } else {
      setTxStatus("loadingMore");
    }
    try {
      const result = await settle(pullTx(page, filterRef.current));
      if (myTx !== txGen.current) return;
      if (!result.ok) {
        setTxStatus("error");
        setTxError(screenErrorMessage(result.err, "Hareketler yüklenemedi. Tekrar dene"));
        txRetryRef.current = { page, mode };
        return;
      }
      applyTxBody(result.value, mode, page);
    } finally {
      if (myTx === txGen.current) txBusy.current = false;
    }
  }, [accountId, applyTxBody, pullTx]);

  const load = useCallback(async () => {
    const gen = ++accountGen.current;
    const myTx = ++txGen.current;
    txBusy.current = true;
    if (!accRef.current) {
      setStatus("loading");
      setTxStatus("loading");
      setTxError(null);
    }
    setError(null);
    const accountTask = settle(withTimeout(get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId, with_month: 1 })));
    const txTask = accountId
      ? settle(pullTx(1, filterRef.current))
      : Promise.resolve({ ok: true as const, value: { items: [], total: 0, has_more: false, page: 1 } });
    try {
      const accountResult = await accountTask;
      if (gen !== accountGen.current) return;
      if (!accountResult.ok) {
        const messageText = screenErrorMessage(accountResult.err, "Hesap yüklenemedi. Tekrar dene");
        setError(messageText);
        if (!accRef.current) setStatus("error");
        return;
      }
      const list = accountResult.value || [];
      setAccounts(list);
      const found = list.find((row) => idOf(row) === accountId) || null;
      accRef.current = found;
      setAcc(found);
      if (!found) {
        setStatus("notfound");
        setTxs([]);
        setTxTotal(0);
        setHasMore(false);
        pageRef.current = 1;
        setTxStatus("ready");
        setTxError(null);
        return;
      }
      setStatus("ready");
      const txResult = await txTask;
      if (gen !== accountGen.current || myTx !== txGen.current) return;
      if (!txResult.ok) {
        setTxStatus("error");
        setTxError(screenErrorMessage(txResult.err, "Hareketler yüklenemedi. Tekrar dene"));
        txRetryRef.current = { page: 1, mode: "replace" };
        return;
      }
      applyTxBody(txResult.value, "replace", 1);
    } finally {
      if (gen === accountGen.current && myTx === txGen.current) txBusy.current = false;
    }
  }, [accountId, applyTxBody, client, companyId, pullTx]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      accountGen.current += 1;
      txGen.current += 1;
    };
  }, [load]));

  const selectFilter = (next: TxFilter) => {
    filterRef.current = next;
    setFilter(next);
    void loadTx(1, "replace");
  };

  const retryTx = () => {
    const retry = txRetryRef.current;
    void loadTx(retry.page, retry.mode);
  };

  const loadMore = () => {
    if (!hasMore || txBusy.current) return;
    void loadTx(pageRef.current + 1, "append");
  };

  const saveTx = async () => {
    if (!canEdit) { setError("Hareket yetkiniz yok."); return; }
    const amt = n(amount);
    if (!(amt > 0)) { setError("Geçerli bir tutar girin."); return; }
    if (txType === "inflow" && !contactId) { setError("Tahsilat için cari seçin."); return; }
    if (!acc) return;
    setBusy(true);
    try {
      const req = accountCashTxRequest({
        companyId,
        account: acc,
        type: txType,
        amount: amt,
        description: desc.trim(),
        date: todayIso(),
        contactId,
        contactName,
      });
      await withTimeout(post(client, req.path, req.body));
      setAmount("");
      setDesc("");
      setContactId("");
      setContactName("");
      setMessage(txType === "inflow" ? "Tahsilat kaydedildi." : "Tediye kaydedildi.");
      setError(null);
      await load();
    } catch (err) {
      setError(screenErrorMessage(err, "Hareket kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!canEdit || !acc || acc.is_integrated) return;
    confirmAction("Hesabı sil", `${acc.account_name} silinsin mi?`, () => {
      withTimeout(del(client, `/banking/accounts/${accountId}`))
        .then(() => router.back())
        .catch((err) => setError(screenErrorMessage(err, "Hesap silinemedi.")));
    });
  };

  const sync = async () => {
    if (!acc?.connection_id || !canEdit) return;
    setSyncing(true);
    try {
      const r = await withTimeout(post<{ message?: string }>(client, `/banking/connections/${acc.connection_id}/sync`, {}));
      setMessage(r?.message || "Hareketler çekildi.");
      setError(null);
      await load();
    } catch (err) {
      setError(screenErrorMessage(err, "Senkronize edilemedi."));
    } finally {
      setSyncing(false);
    }
  };

  if (status === "loading") {
    return (
      <Screen onRefresh={load}>
        {routeName ? (
          <Text numberOfLines={2} style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>{routeName}</Text>
        ) : null}
        <View style={{ height: 88, borderRadius: 18, backgroundColor: "#E2E8F0" }} />
        <Muted>Yükleniyor…</Muted>
      </Screen>
    );
  }

  if (status === "notfound") {
    return <Screen onRefresh={load}><ErrorBanner message="Hesap bulunamadı." /></Screen>;
  }

  if (status === "error" || !acc) {
    return (
      <Screen onRefresh={load}>
        {routeName ? (
          <Text numberOfLines={2} style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>{routeName}</Text>
        ) : null}
        <ErrorBanner message={error || "Hesap yüklenemedi. Tekrar dene"} />
        <PrimaryButton title="Tekrar dene" onPress={() => { void load(); }} testID="bank-detail-retry" color={colors.primary} />
      </Screen>
    );
  }

  const isCard = normalizeAccountType(acc.type) === "credit_card";
  const brand = resolveBankBrand(acc);
  const masked = accountMaskedRef(acc);
  const showSync = !!(acc.is_integrated && acc.connection_id && canEdit);
  const live = acc.is_integrated
    ? `${acc.integration_provider || "API"} · ${acc.integration_status === "connected" ? "CANLI" : "API"}`
    : accountTypeTr(acc.type);
  const unmatchedCount = acc.unmatched_count ?? 0;
  const showTxTotal = txStatus === "ready" || txStatus === "loadingMore" || txs.length > 0;

  return (
    <Screen onRefresh={load}>
      <View style={{ backgroundColor: "#0F172A", borderRadius: 18, padding: 16, gap: 12 }}>
        <Row style={{ alignItems: "center", gap: 12 }}>
          <BankMark brand={brand} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={{ color: "#fff", fontWeight: "800", fontSize: 18 }}>{acc.account_name || acc.bank_name || "Hesap"}</Text>
            <Text style={{ color: "#86EFAC", fontSize: 12, fontWeight: "800", marginTop: 2 }}>{live}</Text>
            <Text testID="bank-iban" style={{ color: "#CBD5E1", fontSize: 12, marginTop: 2 }}>{masked ? `IBAN ${masked}` : "IBAN —"}</Text>
            <Text testID="bank-last-sync" style={{ color: "#94A3B8", fontSize: 12, marginTop: 2 }}>
              Son senkron {acc.last_synced_at ? relativeSyncLabel(acc.last_synced_at) : "—"}
            </Text>
          </View>
        </Row>
        <View>
          <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "800" }}>Bakiye</Text>
          <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800" }}>{fmtMoney(accountBalance(acc), acc.currency)}</Text>
        </View>
        <Row style={{ gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "700" }}>Bu ay giriş</Text>
            <Text testID="bank-month-in" style={{ color: "#6EE7B7", fontWeight: "800", fontSize: 16 }}>{monthText(acc.month_in, acc.currency)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "700" }}>Bu ay çıkış</Text>
            <Text testID="bank-month-out" style={{ color: "#FDA4AF", fontWeight: "800", fontSize: 16 }}>{monthText(acc.month_out, acc.currency)}</Text>
          </View>
        </Row>
      </View>

      <Row style={{ gap: 8 }}>
        {showSync ? (
          <Pressable
            testID="bank-account-sync"
            onPress={sync}
            disabled={syncing}
            style={{ flex: 1, minHeight: 42, borderRadius: 12, backgroundColor: "#0F172A", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 }}
          >
            <Text style={{ color: "#fff", fontWeight: "800" }}>{syncing ? "Senkronize…" : "Senkronize"}</Text>
          </Pressable>
        ) : null}
        {canEdit ? (
          <Pressable
            testID="bank-account-virman"
            onPress={() => go("BankingVirman")}
            style={{ flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.text, fontWeight: "800" }}>Virman</Text>
          </Pressable>
        ) : null}
        {canEdit || canExp ? (
          <Pressable
            testID="bank-account-more"
            onPress={() => setMenu(true)}
            style={{ width: 42, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 18 }}>⋯</Text>
          </Pressable>
        ) : null}
      </Row>

      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      {canEdit && !isCard && !acc.is_integrated ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Tahsilat / tediye</Text>
          <Row>
            <Chip label="Tahsilat" active={txType === "inflow"} testID="bank-tx-in" onPress={() => setTxType("inflow")} />
            <Chip label="Tediye" active={txType === "outflow"} color={colors.danger} testID="bank-tx-out" onPress={() => setTxType("outflow")} />
          </Row>
          <ContactSearchSelect
            label={txType === "inflow" ? "Cari" : "Cari (opsiyonel)"}
            testID="bank-tx-contact"
            value={contactId}
            valueLabel={contactName}
            emptyLabel={txType === "inflow" ? "Cari seçin" : "Cari yok — yalnız kasa"}
            placeholder="Cari adı, ünvan, VKN, telefon veya cari kodu"
            onChange={(cid, c) => { setContactId(cid); setContactName(c?.name || ""); }}
          />
          {txType === "inflow" ? <Muted>Tahsilat için cari seçin; tutar cari bakiyesine işlenir.</Muted> : null}
          <MoneyInput label="Tutar" testID="bank-tx-amount" value={amount} onChange={(n) => setAmount(n ?? "")} />
          <Field label="Açıklama" testID="bank-tx-desc" value={desc} onChangeText={setDesc} />
          <PrimaryButton title={busy ? "Kaydediliyor…" : "Hareketi kaydet"} onPress={saveTx} loading={busy} color={colors.primary} testID="bank-tx-save" />
        </Card>
      ) : isCard ? <Muted>Kredi kartında tahsilat kapalı; masraf veya ekstre kullanın.</Muted> : null}

      <Row style={{ flexWrap: "wrap" }}>
        <Chip label="Tümü" active={filter === "all"} testID="bank-filter-all" onPress={() => selectFilter("all")} />
        <Chip label="Giriş" active={filter === "in"} testID="bank-filter-in" onPress={() => selectFilter("in")} />
        <Chip label="Çıkış" active={filter === "out"} color={colors.danger} testID="bank-filter-out" onPress={() => selectFilter("out")} />
        <Chip label={`Eşleşmemiş ${unmatchedCount}`} active={filter === "unmatched"} color="#F59E0B" testID="bank-filter-unmatched" onPress={() => selectFilter("unmatched")} />
      </Row>

      <Text style={{ fontWeight: "800", color: colors.text }}>Hareketler</Text>
      {showTxTotal ? <Text testID="bank-tx-total">{txTotal} hareket</Text> : null}
      {txStatus === "loading" || txStatus === "loadingMore" ? <Muted>Yükleniyor…</Muted> : null}
      {txStatus === "error" ? (
        <View style={{ gap: 8 }}>
          <ErrorBanner message={txError || "Hareketler yüklenemedi. Tekrar dene"} />
          <PrimaryButton title="Tekrar dene" onPress={retryTx} testID="bank-tx-retry" color={colors.primary} />
        </View>
      ) : null}
      {txStatus === "ready" && !txs.length ? <Muted>Hareket yok.</Muted> : null}
      {txs.map((tx) => (
        <BankTxCard
          key={idOf(tx)}
          tx={tx}
          account={acc}
          accounts={accounts}
          canEdit={canEdit}
          onChanged={load}
          onMessage={setMessage}
          onError={setError}
        />
      ))}
      {hasMore && txStatus !== "error" ? (
        <PrimaryButton
          title="Daha fazla"
          onPress={loadMore}
          loading={txStatus === "loadingMore"}
          testID="bank-tx-more"
          color={colors.primary}
        />
      ) : null}

      <B2BSheet visible={menu} title={acc.account_name || "Hesap"} onClose={() => setMenu(false)} testID="bank-account-menu">
        {canEdit ? (
          <Pressable testID="bank-edit" onPress={() => { setMenu(false); go("BankingEdit", { id: accountId }); }} style={{ paddingVertical: 12 }}>
            <Text style={{ fontWeight: "800", color: colors.text }}>Hesabı düzenle</Text>
          </Pressable>
        ) : null}
        {canExp ? (
          <Pressable testID="bank-expense-btn" onPress={() => { setMenu(false); go("ExpenseNew", { account_id: accountId }); }} style={{ paddingVertical: 12 }}>
            <Text style={{ fontWeight: "800", color: colors.danger }}>Masraf ekle</Text>
          </Pressable>
        ) : null}
        {canEdit ? (
          <Pressable
            testID="bank-delete"
            disabled={!!acc.is_integrated}
            onPress={() => { if (acc.is_integrated) return; setMenu(false); remove(); }}
            style={{ paddingVertical: 12, opacity: acc.is_integrated ? 0.35 : 1, flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={{ color: colors.danger, fontWeight: "800" }}>{acc.is_integrated ? "Entegre hesap silinemez" : "Hesabı sil"}</Text>
          </Pressable>
        ) : null}
      </B2BSheet>
    </Screen>
  );
}
