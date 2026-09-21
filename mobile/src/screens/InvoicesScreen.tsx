import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Empty, ErrorBanner, Field, ListRow, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import type { Invoice } from "../types";
import { createInvoiceButtonLabel, INVOICE_FILTERS, invoiceListSubtitle, invoiceListTitle } from "../utils/invoiceDraft";
import { fmtMoney, idOf } from "../utils/money";

const FILTER_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  all: { icon: "apps-outline", color: colors.slate800 },
  sales: { icon: "receipt-outline", color: colors.primary },
  purchase: { icon: "cart-outline", color: colors.indigo },
  proforma: { icon: "document-text-outline", color: "#0EA5E9" },
  return: { icon: "return-down-back-outline", color: colors.danger },
  export: { icon: "airplane-outline", color: "#0284C7" },
  import: { icon: "download-outline", color: "#7C3AED" },
  dispatch: { icon: "cube-outline", color: "#D97706" },
};

export function InvoicesScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/invoices", "edit");
  const [rows, setRows] = useState<Invoice[]>([]);
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<Invoice[]>(client, "/invoices", { company_id: companyId, type: type === "all" ? undefined : type });
      setRows(data || []);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Faturalar yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, type]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? rows.filter((i) => [i.invoice_number, i.contact_name].some((v) => String(v || "").toLowerCase().includes(s)))
      : rows;
    return list.slice(0, 80);
  }, [q, rows]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      {canEdit ? (
        <PrimaryButton
          title={createInvoiceButtonLabel(type)}
          onPress={() => go("InvoiceNew", { type })}
          color={colors.primary}
          testID="create-new-invoice-btn"
        />
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {INVOICE_FILTERS.map((f) => {
          const meta = FILTER_ICONS[f.key] || FILTER_ICONS.all;
          const active = type === f.key;
          return (
            <Pressable
              key={f.key}
              testID={`filter-tab-${f.key}`}
              accessibilityLabel={f.label}
              onPress={() => setType(f.key)}
              style={{ width: "25%", alignItems: "center", gap: 4, paddingVertical: 6 }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: active ? meta.color : colors.slate100,
                }}
              >
                <Ionicons name={meta.icon} size={20} color={active ? "#fff" : colors.muted} />
              </View>
              <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: "800", color: active ? meta.color : colors.muted }}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Field label="Ara" value={q} onChangeText={setQ} placeholder="Fatura no / cari" testID="inv-search" />
      <ErrorBanner message={error} />
      {!filtered.length ? (
        <Empty
          icon="document-outline"
          title="Fatura yok"
          hint={canEdit ? "Yeni fatura kesin veya taslak düzenleyin." : "Aramayı veya filtreyi değiştirin."}
        />
      ) : filtered.map((inv) => (
        <ListRow
          key={idOf(inv)}
          testID={`inv-row-${idOf(inv)}`}
          title={invoiceListTitle(inv)}
          subtitle={invoiceListSubtitle(inv)}
          right={fmtMoney(inv.grand_total, inv.currency)}
          onPress={() => go("InvoiceDetail", { id: idOf(inv) })}
        />
      ))}
    </Screen>
  );
}
