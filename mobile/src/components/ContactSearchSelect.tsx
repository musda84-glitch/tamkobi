import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { get } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { colors, radius, spacing } from "../theme";
import type { Contact } from "../types";
import { BALANCE_TONE_COLOR, contactBalanceBadge } from "../utils/contactBalance";
import { CONTACT_SEARCH_DEBOUNCE_MS, contactSearchQuery } from "../utils/contactSearch";
import { idOf } from "../utils/money";
import { Muted } from "./kit";

type SearchPayload = {
  items?: Contact[];
  suggestions?: Contact[];
  suggest_query?: string;
  has_more?: boolean;
};

const subLine = (c: Contact) => [c.company_title, c.tax_number_or_id, c.phone, c.category].filter(Boolean).join(" · ");

function BalanceMark({ contact, testID }: { contact: Contact; testID?: string }) {
  const badge = contactBalanceBadge(contact);
  return (
    <Text testID={testID} style={{ fontWeight: "800", fontSize: 12, color: BALANCE_TONE_COLOR[badge.tone] }}>
      {badge.text}
    </Text>
  );
}

/**
 * Banka eşleşmesi, kasa tahsilat/ödeme ve masraf tedarikçisi için aranabilir cari.
 * Yazıldıkça /contacts/search; Firma Adı önerileri listenin üstünde.
 */
export function ContactSearchSelect({
  label,
  value,
  valueLabel = "",
  onChange,
  emptyLabel,
  testID,
  suggestText = "",
  counterparty = "",
  excludeType = "",
  placeholder = "Cari ara…",
}: {
  label?: string;
  value: string;
  valueLabel?: string;
  onChange: (id: string, contact: Contact | null) => void;
  emptyLabel?: string;
  testID?: string;
  suggestText?: string;
  counterparty?: string;
  excludeType?: string;
  placeholder?: string;
}) {
  const { client, companyId } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Contact[]>([]);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [suggestQuery, setSuggestQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Contact | null>(null);
  const req = useRef(0);

  useEffect(() => {
    if (!open || !companyId) return undefined;
    const query = String(q || "");
    const handle = { timer: null as ReturnType<typeof setTimeout> | null, cancelled: false };
    const run = () => {
      const id = ++req.current;
      setLoading(true);
      get<SearchPayload>(client, "/contacts/search", contactSearchQuery({
        companyId,
        q: query,
        page: 1,
        suggest: suggestText,
        counterparty,
        excludeType,
      })).then((data) => {
        if (handle.cancelled || id !== req.current) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
        setSuggestQuery(String(data?.suggest_query || ""));
        setPage(1);
        setHasMore(!!data?.has_more);
      }).catch(() => {
        if (handle.cancelled || id !== req.current) return;
        setItems([]);
        setSuggestions([]);
        setHasMore(false);
      }).finally(() => {
        if (!handle.cancelled && id === req.current) setLoading(false);
      });
    };
    if (query.trim()) handle.timer = setTimeout(run, CONTACT_SEARCH_DEBOUNCE_MS);
    else run();
    return () => {
      handle.cancelled = true;
      if (handle.timer) clearTimeout(handle.timer);
    };
  }, [open, q, companyId, client, suggestText, counterparty, excludeType]);

  const loadMore = () => {
    if (!companyId || loading || !hasMore) return;
    const next = page + 1;
    const id = ++req.current;
    setLoading(true);
    get<SearchPayload>(client, "/contacts/search", contactSearchQuery({
      companyId,
      q,
      page: next,
      suggest: suggestText,
      counterparty,
      excludeType,
    })).then((data) => {
      if (id !== req.current) return;
      const more = Array.isArray(data?.items) ? data.items : [];
      setItems((prev) => {
        const seen = new Set(prev.map((c) => idOf(c)));
        return [...prev, ...more.filter((c) => !seen.has(idOf(c)))];
      });
      setPage(next);
      setHasMore(!!data?.has_more);
    }).catch(() => {
      if (id === req.current) setHasMore(false);
    }).finally(() => {
      if (id === req.current) setLoading(false);
    });
  };

  const sugIds = new Set(suggestions.map((c) => idOf(c)).filter(Boolean));
  const rest = items.filter((c) => !sugIds.has(idOf(c)));
  const selected = items.find((c) => idOf(c) === value)
    || suggestions.find((c) => idOf(c) === value)
    || (picked && idOf(picked) === value ? picked : null);
  const title = selected?.name || (value && valueLabel ? valueLabel : "") || emptyLabel || placeholder;

  const choose = (contact: Contact | null) => {
    setPicked(contact);
    onChange(contact ? idOf(contact) : "", contact);
    setOpen(false);
    setQ("");
  };

  const row = (c: Contact, suggested: boolean) => {
    const id = idOf(c);
    return (
      <Pressable
        key={`${suggested ? "s" : "i"}-${id}`}
        testID={testID ? `${testID}-${suggested ? "suggest" : "option"}-${id}` : undefined}
        onPress={() => choose(c)}
        style={{ paddingHorizontal: 12, paddingVertical: 10, backgroundColor: id === value ? colors.emerald50 : "#fff" }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontWeight: "700", color: colors.text }}>
            {c.name || "Cari"}
            {suggested ? "  · öneri" : ""}
          </Text>
          <BalanceMark contact={c} testID={testID ? `${testID}-balance-${id}` : undefined} />
        </View>
        {subLine(c) ? <Text style={{ color: colors.muted, fontSize: 12 }}>{subLine(c)}</Text> : null}
      </Pressable>
    );
  };

  return (
    <View style={{ marginBottom: spacing.md }} testID={testID ? `${testID}-wrap` : undefined}>
      {label ? <Muted>{label}</Muted> : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={() => setOpen((v) => !v)}
        style={{
          minHeight: 48,
          borderWidth: 1.5,
          borderColor: "#C7D2FE",
          borderRadius: radius.md,
          paddingHorizontal: 12,
          backgroundColor: colors.indigo50,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text numberOfLines={1} style={{ flex: 1, fontWeight: "700", color: value ? colors.text : colors.muted }}>{title}</Text>
        {selected ? <BalanceMark contact={selected} testID={testID ? `${testID}-selected-balance` : undefined} /> : null}
        <Ionicons name="chevron-down" size={18} color={colors.indigo} />
      </Pressable>
      {open ? (
        <View testID={testID ? `${testID}-menu` : undefined} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: 6, backgroundColor: "#fff", overflow: "hidden" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Ionicons name="search" size={16} color={colors.muted} />
            <TextInput
              testID={testID ? `${testID}-search` : undefined}
              value={q}
              onChangeText={setQ}
              placeholder={placeholder}
              placeholderTextColor={colors.muted}
              autoFocus
              style={{ flex: 1, minHeight: 36, fontSize: 14, fontWeight: "600", color: colors.text, padding: 0 }}
            />
          </View>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 280 }}>
            {emptyLabel != null && emptyLabel !== "" ? (
              <Pressable testID={testID ? `${testID}-empty` : undefined} onPress={() => choose(null)} style={{ padding: 12 }}>
                <Text style={{ fontWeight: "700", color: colors.muted }}>{emptyLabel}</Text>
              </Pressable>
            ) : null}
            {suggestQuery ? (
              <Text testID={testID ? `${testID}-suggest-head` : undefined} style={{ paddingHorizontal: 12, paddingTop: 8, fontSize: 11, fontWeight: "800", color: "#6D28D9" }}>
                {`FİRMA ADI · ${suggestQuery}`}
              </Text>
            ) : null}
            {suggestions.map((c) => row(c, true))}
            {loading && items.length === 0 && suggestions.length === 0 ? (
              <ActivityIndicator color={colors.primary} style={{ margin: 12 }} />
            ) : null}
            {!loading && rest.length === 0 && suggestions.length === 0 ? (
              <Text style={{ padding: 12, fontWeight: "600", color: colors.muted, fontSize: 13 }}>Sonuç yok</Text>
            ) : null}
            {rest.map((c) => row(c, false))}
            {hasMore ? (
              <Pressable testID={testID ? `${testID}-more` : undefined} onPress={loadMore} style={{ padding: 12 }}>
                <Text style={{ fontWeight: "800", color: colors.primary }}>{loading ? "Yükleniyor…" : "Daha fazla"}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
