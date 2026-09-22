import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Chip } from "../components/chips";
import { Badge, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Contact } from "../types";
import { contactBalanceLabel, contactDisplayBalance, type ContactBalanceFlag } from "../utils/contactDisplay";
import { CONTACT_LIST_CHIPS, filterContacts, type ContactBalanceFilter, type ContactTypeFilter } from "../utils/contactFilters";
import { cacheIsFresh, peekCachedRows, readCachedRows, writeCachedRows } from "../utils/listCache";
import { LIST_INITIAL_ROWS, nextRowLimit, visibleRows } from "../utils/listPaging";
import { fmtMoney, idOf } from "../utils/money";

type FlagMap = Record<string, ContactBalanceFlag>;

function flagsFromCache(cached: { rows?: FlagMap[] } | null): FlagMap {
  const first = cached?.rows?.[0];
  return first && typeof first === "object" ? first : {};
}

export function ContactsScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/contacts", "edit");
  const [rows, setRows] = useState<Contact[]>([]);
  const [flags, setFlags] = useState<FlagMap>({});
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState<ContactTypeFilter>("all");
  const [balF, setBalF] = useState<ContactBalanceFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shown, setShown] = useState(LIST_INITIAL_ROWS);

  useEffect(() => {
    const mem = peekCachedRows<Contact>("contacts", companyId);
    if (mem?.rows?.length) setRows(mem.rows);
    const memFlags = peekCachedRows<FlagMap>("contact-flags", companyId);
    if (memFlags?.rows?.length) setFlags(flagsFromCache(memFlags));
    readCachedRows<Contact>("contacts", companyId).then((cached) => {
      if (cached?.rows?.length) setRows(cached.rows);
    });
    readCachedRows<FlagMap>("contact-flags", companyId).then((cached) => {
      if (cached?.rows?.length) setFlags(flagsFromCache(cached));
    });
  }, [companyId]);

  const loadFlags = useCallback(async () => {
    try {
      const flagRows = await get<FlagMap>(client, "/contacts/flags", { company_id: companyId }).catch(() => ({}));
      const next = flagRows || {};
      setFlags(next);
      await writeCachedRows("contact-flags", companyId, [next]);
    } catch {
      /* Kayıtlı bakiye listedeyse flag hatası cariyi gizlemesin. */
    }
  }, [client, companyId]);

  const load = useCallback(async (force = false) => {
    const cached = peekCachedRows<Contact>("contacts", companyId) || await readCachedRows<Contact>("contacts", companyId);
    if (cached?.rows?.length) setRows(cached.rows);
    const cachedFlags = peekCachedRows<FlagMap>("contact-flags", companyId) || await readCachedRows<FlagMap>("contact-flags", companyId);
    if (cachedFlags?.rows?.length) setFlags(flagsFromCache(cachedFlags));
    if (!force && cacheIsFresh(cached?.savedAt) && cached?.rows?.length) {
      if (!cacheIsFresh(cachedFlags?.savedAt)) void loadFlags();
      return;
    }
    const waitForFirst = !cached?.rows?.length;
    if (force || waitForFirst) setRefreshing(true);
    try {
      const data = await get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true });
      const next = data || [];
      setRows(next);
      await writeCachedRows("contacts", companyId, next);
      setError(null);
    } catch (err) {
      if (!cached?.rows?.length) setError(apiErrorMessage(err, "Cariler yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
    void loadFlags();
  }, [client, companyId, loadFlags]);

  useFocusEffect(useCallback(() => { load(false); }, [load]));

  const amountOf = useCallback(
    (c: Contact) => contactDisplayBalance(c, null, flags[idOf(c)]),
    [flags],
  );

  const matched = useMemo(
    () => filterContacts(rows, typeF, q, 5000, balF, amountOf),
    [amountOf, balF, q, rows, typeF],
  );
  const filtered = useMemo(() => visibleRows(matched, shown), [matched, shown]);
  const hasMore = shown < matched.length;

  useEffect(() => {
    setShown(LIST_INITIAL_ROWS);
  }, [q, typeF, balF]);

  const chipCounts = useMemo(() => {
    const receivable = rows.filter((c) => amountOf(c) > 0).length;
    const payable = rows.filter((c) => amountOf(c) < 0).length;
    return { receivable, payable };
  }, [amountOf, rows]);

  return (
    <Screen
      onRefresh={() => load(true)}
      refreshing={refreshing}
      stickyTop={<Field label="Ara" testID="contacts-search" value={q} onChangeText={setQ} placeholder="Ad, telefon, VKN" />}
    >
      {canEdit ? (
        <PrimaryButton title="Yeni cari ekle" onPress={() => go("ContactNew")} color={colors.primary} testID="add-contact-btn" />
      ) : null}
      <View testID="contacts-filter-row" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {CONTACT_LIST_CHIPS.map((t) => {
          const count = t.balance === "receivable" ? chipCounts.receivable : t.balance === "payable" ? chipCounts.payable : undefined;
          const label = count != null ? `${t.label} (${count})` : t.label;
          const active = t.balance ? balF === t.balance : typeF === t.type && (t.type !== "all" || balF === "all");
          return (
            <Chip
              key={t.key}
              label={label}
              active={active}
              testID={t.balance ? `contacts-balance-${t.key}` : `contacts-type-${t.key}`}
              color={t.balance === "payable" ? colors.danger : t.balance === "receivable" ? colors.primaryHover : colors.primary}
              onPress={() => {
                if (t.balance) {
                  setBalF((cur) => (cur === t.balance ? "all" : t.balance!));
                  return;
                }
                setTypeF(t.type || "all");
                if (t.type === "all") setBalF("all");
              }}
            />
          );
        })}
      </View>
      <ErrorBanner message={error} />
      {!filtered.length ? <Empty icon="people-outline" title="Cari bulunamadı" hint={canEdit ? "Yeni cari kartı ekleyin." : undefined} /> : filtered.map((c) => {
        const id = idOf(c);
        const bal = contactDisplayBalance(c, null, flags[id]);
        const side = contactBalanceLabel(bal);
        return (
          <ListRow
            key={id}
            testID={`contact-row-${id}`}
            title={c.name}
            subtitle={[c.city, c.phone].filter(Boolean).join(" · ")}
            right={fmtMoney(bal)}
            rightColor={bal > 0 ? colors.primaryHover : bal < 0 ? colors.danger : colors.text}
            rightSub={side.label}
            rightSubColor={bal > 0 ? colors.primaryHover : bal < 0 ? colors.danger : colors.muted}
            badge={<Badge label={side.label} tone={side.tone === "green" ? "green" : side.tone === "red" ? "red" : "slate"} />}
            onPress={() => go("ContactDetail", { id, name: c.name })}
          />
        );
      })}
      {hasMore ? (
        <PrimaryButton
          title={`Daha fazla göster (${filtered.length} / ${matched.length})`}
          onPress={() => setShown((n) => nextRowLimit(n, matched.length))}
          color={colors.secondary}
          testID="contacts-load-more"
        />
      ) : matched.length > LIST_INITIAL_ROWS ? (
        <Muted testID="contacts-list-count">{matched.length} cari</Muted>
      ) : null}
    </Screen>
  );
}
