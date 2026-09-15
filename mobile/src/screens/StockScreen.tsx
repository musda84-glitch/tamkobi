import React, { useCallback, useEffect, useMemo, useState } from "react";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { Empty, ErrorBanner, Field, ListRow, PrimaryButton, Screen } from "../components/ui";
import type { Product } from "../types";
import { fmtMoney, idOf } from "../utils/money";

export function StockScreen() {
  const { client, companyId } = useAuth();
  const [rows, setRows] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [scan, setScan] = useState(false);
  const [hit, setHit] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await get<Product[]>(client, "/products", { company_id: companyId, lite: true });
      setRows((data || []).filter((p) => p.is_active !== false));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Stok yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId]);

  useEffect(() => { load(); }, [load]);

  const lookup = async (code: string) => {
    try {
      const local = rows.find((p) => p.barcode === code || p.sku === code);
      if (local) { setHit(local); setQ(code); return; }
      const p = await get<Product>(client, `/products/barcode/${encodeURIComponent(code)}`, { company_id: companyId });
      setHit(p);
      setQ(code);
    } catch (err) {
      setHit(null);
      setError(apiErrorMessage(err, "Barkod ile ürün bulunamadı."));
    }
  };

  const filtered = useMemo(() => {
    if (hit) return [hit];
    const s = q.trim().toLowerCase();
    if (s.length < 2) return rows.slice(0, 40);
    return rows.filter((p) => [p.name, p.sku, p.barcode].some((v) => String(v || "").toLowerCase().includes(s))).slice(0, 40);
  }, [hit, q, rows]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <PrimaryButton title="Barkod okut" onPress={() => setScan(true)} testID="stock-scan" />
      <Field label="Ara" value={q} onChangeText={(v) => { setQ(v); setHit(null); }} placeholder="Ad, SKU, barkod" />
      <ErrorBanner message={error} />
      {!filtered.length ? <Empty icon="barcode-outline" title="Ürün yok" hint="En az 2 karakter yazın veya barkod okutun." /> : filtered.map((p) => (
        <ListRow
          key={idOf(p)}
          title={p.name}
          subtitle={`${p.sku || "SKU yok"} · stok ${p.stock_quantity ?? "—"} ${p.unit || ""}`}
          right={fmtMoney(p.sale_price)}
        />
      ))}
      <BarcodeScannerModal visible={scan} onClose={() => setScan(false)} onScan={lookup} />
    </Screen>
  );
}
