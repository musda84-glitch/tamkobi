import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors } from "../theme";
import type { Product } from "../types";
import { computeLine, emptyLine, hydrateLine, type InvoiceLine } from "../utils/documentLines";
import { applyLineNameDraft, type LineProductHit } from "../utils/lineProductSearch";
import { fmtMoney } from "../utils/money";
import { B2BSheet } from "./b2b/B2BSheet";
import { Chip, confirmAction } from "./chips";
import { Field, Muted, PrimaryButton, Row } from "./kit";
import { LineProductNameField } from "./LineProductNameField";
import { MoneyInput, QuantityInput } from "./MoneyInput";
import { ProductThumb } from "./ProductThumb";

const VAT_CHIP_ORDER = [0, 1, 10, 20];
const UNIT_PRESETS = ["Adet", "Kg", "Metre", "m²", "Litre", "Paket", "Kutu", "Saat"];

function unitChoices(current: string, productUnit?: string): string[] {
  const out: string[] = [];
  for (const raw of [current, productUnit, ...UNIT_PRESETS]) {
    const unit = String(raw || "").trim();
    if (unit && !out.includes(unit)) out.push(unit);
  }
  return out;
}

function qtyText(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return n.toLocaleString("tr-TR");
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 3 });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function InvoiceLineSheet({
  visible,
  index,
  count,
  line,
  currency = "TRY",
  tradeKind,
  allowDelete,
  editable = true,
  imageUri = "",
  stockQty,
  productUnit,
  loadHits,
  resolveProduct,
  onScan,
  onBindApply,
  onReportLine,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  visible: boolean;
  index: number;
  count: number;
  line: InvoiceLine | null;
  currency?: string;
  tradeKind?: string;
  allowDelete: boolean;
  editable?: boolean;
  imageUri?: string;
  stockQty?: number | null;
  productUnit?: string;
  loadHits: (q: string) => Promise<LineProductHit[]>;
  resolveProduct?: (hit: LineProductHit | Product, current: InvoiceLine, scanCode?: string) => Promise<InvoiceLine>;
  onScan?: () => void;
  onBindApply?: (apply: ((line: InvoiceLine) => void) | null) => void;
  onReportLine?: (line: InvoiceLine) => void;
  onClose: () => void;
  onSave: (line: InvoiceLine) => void;
  onDelete: () => void;
  busy?: boolean;
}) {
  const [local, setLocal] = useState<InvoiceLine>(() => hydrateLine(line || emptyLine()));
  const [seedProductId] = useState(() => String(line?.product_id || ""));
  const [incl, setIncl] = useState(false);
  const [picking, setPicking] = useState(!String(line?.product_id || ""));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    onBindApply?.((next) => {
      const hydrated = hydrateLine(next);
      setLocal(hydrated);
      setNotice("");
    });
    return () => onBindApply?.(null);
  }, [onBindApply]);

  useEffect(() => {
    onReportLine?.(local);
  }, [local, onReportLine]);

  const foreign = tradeKind === "export" || tradeKind === "import";
  const priced = computeLine(local, incl ? "unit_price_incl" : "unit_price");
  const gross = round2(priced.quantity * priced.unit_price);
  const discountAmt = round2(gross - priced.total);
  const stockText = stockQty == null || !Number.isFinite(Number(stockQty))
    ? "—"
    : Number(stockQty).toLocaleString("tr-TR");
  const unlink = !!seedProductId && !priced.product_id;
  const showNameField = picking || !priced.product_id;

  const patch = (field: string, value: unknown, editedField = field) => {
    setNotice("");
    setLocal((cur) => computeLine({ ...cur, [field]: value } as InvoiceLine, editedField));
  };

  const setPrice = (n: number | null) => {
    if (n == null) return;
    patch(incl ? "unit_price_incl" : "unit_price", n);
  };

  const setQty = (n: number | null) => {
    if (n == null) return;
    patch("quantity", n);
  };

  const bumpQty = (delta: number) => {
    const next = Math.round((Number(priced.quantity) + delta) * 1000) / 1000;
    patch("quantity", next < 0 ? 0 : next);
  };

  const switchKind = (service: boolean) => {
    if (!editable) return;
    if (service === !!priced.is_service) return;
    if (service && priced.product_id) {
      confirmAction("Ürün → Hizmet", "Ürün bağı kaldırılacak", () => {
        setNotice("");
        setLocal((cur) => computeLine({ ...cur, is_service: true, product_id: "" }));
        setPicking(true);
      });
      return;
    }
    setLocal((cur) => computeLine({ ...cur, is_service: service }));
    if (!service) setPicking(true);
  };

  const askDelete = () => {
    if (!allowDelete) {
      setNotice("En az bir kalem gerekli.");
      return;
    }
    confirmAction("Satırı sil", "Bu satır silinsin mi?", () => onDelete());
  };

  const save = () => {
    if (!editable) return;
    const name = String(priced.name || priced.product_name || "").trim();
    if (!name) {
      setNotice("Kalem adı gerekli.");
      return;
    }
    if (!(priced.quantity > 0) || priced.unit_price < 0) {
      setNotice("Miktar ve fiyat geçerli olmalı.");
      return;
    }
    onSave(priced);
  };

  const counterpart = incl
    ? `KDV hariç karşılığı ${fmtMoney(priced.unit_price, currency)}`
    : `KDV dahil karşılığı ${fmtMoney(priced.unit_price_incl, currency)}`;

  return (
    <B2BSheet
      visible={visible}
      title={`Satırı düzenle · ${index + 1}/${Math.max(count, 1)}`}
      onClose={onClose}
      testID="inv-line-sheet"
      footer={(
        <View style={{ gap: 8 }}>
          {notice ? <Text testID="inv-line-notice" style={{ color: colors.danger, fontWeight: "800" }}>{notice}</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              testID="inv-line-delete"
              accessibilityLabel="Sil"
              onPress={askDelete}
              style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.danger }}
            >
              <Text style={{ color: colors.danger, fontWeight: "800" }}>Sil</Text>
            </Pressable>
            <View style={{ flex: 1.5 }}>
              <PrimaryButton title={busy ? "Kaydediliyor…" : "Kaydet"} testID="inv-line-save" color="#F59E0B" onPress={save} loading={busy} disabled={!editable} />
            </View>
          </View>
        </View>
      )}
    >
      <View testID={`inv-item-kind-${index}`} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
        <Chip label="Ürün" active={!priced.is_service} onPress={() => switchKind(false)} testID="inv-item-kind-product" color={colors.primary} />
        <Chip label="Hizmet" active={!!priced.is_service} onPress={() => switchKind(true)} testID="inv-item-kind" color={colors.indigo} />
      </View>

      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.muted, marginBottom: 6 }}>ÜRÜN</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <ProductThumb uri={imageUri} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={{ fontWeight: "800", color: colors.text }}>{priced.name || priced.product_name || "Ürün adı"}</Text>
          <Muted>{`SKU ${priced.sku || "—"} · Stok ${stockText}`}</Muted>
        </View>
        <Pressable testID="inv-line-change" onPress={() => setPicking(true)} hitSlop={8}>
          <Text style={{ color: "#B45309", fontWeight: "800" }}>Değiştir</Text>
        </Pressable>
      </View>
      {showNameField ? (
        <View testID={`inv-item-name-${index}`}>
          <LineProductNameField
            testID="inv-item-name"
            label={priced.is_service ? "Hizmet adı" : "Ürün adı"}
            value={priced.name}
            isService={!!priced.is_service}
            editable={editable}
            placeholder={priced.is_service ? "Hizmet adı yazın" : "Ürün adı / SKU / barkod"}
            loadHits={loadHits}
            excludeProductId={priced.product_id}
            onChangeText={(v) => {
              setNotice("");
              setLocal((cur) => {
                const next = applyLineNameDraft(cur, v);
                return computeLine({ ...next, product_name: next.name || "" });
              });
            }}
            onSelect={(hit) => {
              if (!resolveProduct) return;
              void resolveProduct(hit, priced).then((next) => {
                setLocal(hydrateLine(next));
                setPicking(false);
                setNotice("");
              });
            }}
            onScanPress={editable && !priced.is_service ? onScan : undefined}
          />
        </View>
      ) : null}
      {unlink ? <Text testID="inv-line-unlink" style={{ color: "#B45309", fontWeight: "700", marginBottom: 8 }}>Stok bağı kaldırılacak</Text> : null}

      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.muted, marginTop: 8, marginBottom: 6 }}>ADET VE BİRİM</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          testID="inv-line-qty-dec"
          accessibilityLabel="Adet azalt"
          onPress={() => bumpQty(-1)}
          style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontWeight: "800", fontSize: 18, color: colors.text }}>−</Text>
        </Pressable>
        <View style={{ flex: 1 }} testID={`inv-item-qty-${index}`}>
          <QuantityInput testID="inv-item-qty" value={priced.quantity} editable={editable} onChange={setQty} />
        </View>
        <Pressable
          testID="inv-line-qty-inc"
          accessibilityLabel="Adet artır"
          onPress={() => bumpQty(1)}
          style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontWeight: "800", fontSize: 18, color: colors.text }}>+</Text>
        </Pressable>
      </View>
      <Row style={{ flexWrap: "wrap", marginTop: 6 }}>
        {unitChoices(priced.unit, productUnit).map((unit) => (
          <Chip key={unit} compact label={unit} active={priced.unit === unit} onPress={() => patch("unit", unit)} testID={`inv-line-unit-${unit}`} />
        ))}
      </Row>
      <View testID={`inv-item-unit-${index}`}>
        <Field compact label="Birim" testID="inv-item-unit" value={priced.unit} onChangeText={(v) => patch("unit", v)} />
      </View>

      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.muted, marginBottom: 6 }}>BİRİM FİYAT</Text>
      <View testID="inv-line-incl-toggle" style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
        <Chip label="KDV hariç" active={!incl} onPress={() => setIncl(false)} testID="inv-line-price-excl" color="#F59E0B" />
        <Chip label="KDV dahil" active={incl} onPress={() => setIncl(true)} testID="inv-line-price-incl" color="#F59E0B" />
      </View>
      <View testID={`inv-item-price-${index}`}>
        <MoneyInput
          testID="inv-item-price"
          value={incl ? priced.unit_price_incl : priced.unit_price}
          editable={editable}
          suffix={currency === "TRY" ? "₺" : currency}
          onChange={setPrice}
        />
      </View>
      <Text testID={`inv-item-price-incl-${index}`} style={{ color: colors.muted, fontWeight: "700", marginBottom: 8 }}>{counterpart}</Text>

      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.muted, marginBottom: 6 }}>KDV</Text>
      <Row style={{ flexWrap: "wrap" }}>
        {VAT_CHIP_ORDER.map((v) => (
          <Chip
            key={v}
            label={`%${v}`}
            active={Number(priced.vat_rate) === v}
            onPress={() => patch("vat_rate", v, incl ? "unit_price_incl" : "unit_price")}
            testID={`inv-item-vat-${v}`}
            color="#F59E0B"
          />
        ))}
      </Row>

      <Text style={{ fontSize: 11, fontWeight: "800", color: colors.muted, marginTop: 8, marginBottom: 6 }}>İSKONTO</Text>
      <View testID={`inv-item-disc-${index}`}>
        <MoneyInput
          label="İskonto %"
          testID="inv-item-disc"
          value={priced.discount_rate || ""}
          editable={editable}
          suffix="%"
          onChange={(n) => patch("discount_rate", n ?? 0)}
        />
      </View>

      {foreign ? (
        <Row style={{ gap: 8 }}>
          <View style={{ flex: 1 }} testID={`inv-item-gtip-${index}`}>
            <Field compact label="GTIP" testID="inv-item-gtip" value={priced.gtip || ""} onChangeText={(v) => patch("gtip", v)} />
          </View>
          <View style={{ flex: 1 }} testID={`inv-item-origin-${index}`}>
            <Field compact label="Menşe" testID="inv-item-origin" value={priced.origin_country || ""} onChangeText={(v) => patch("origin_country", v)} />
          </View>
        </Row>
      ) : null}

      <View testID="inv-line-breakdown" style={{ marginTop: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, gap: 6, backgroundColor: colors.slate50 }}>
        <BreakRow label={`${qtyText(priced.quantity)} × ${fmtMoney(priced.unit_price, currency)}`} value="" />
        {discountAmt > 0 ? (
          <BreakRow label="İskonto" value={`-${fmtMoney(discountAmt, currency)}`} color={colors.danger} />
        ) : null}
        <BreakRow label="KDV matrahı" value={fmtMoney(priced.total, currency)} />
        <BreakRow label={`KDV %${priced.vat_rate}`} value={fmtMoney(priced.vat_amount, currency)} />
        <BreakRow label="Satır toplamı" value={fmtMoney(priced.total_incl, currency)} color="#B45309" strong />
      </View>
    </B2BSheet>
  );
}

function BreakRow({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ color: color || colors.muted, fontWeight: strong ? "800" : "700", flex: 1 }}>{label}</Text>
      {value ? <Text style={{ color: color || colors.text, fontWeight: strong ? "800" : "700" }}>{value}</Text> : null}
    </View>
  );
}
