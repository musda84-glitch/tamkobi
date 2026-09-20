import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { GroupedSelect } from "../components/GroupedSelect";
import { ProductPickRow } from "../components/ProductPickRow";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { colors } from "../theme";
import type { Contact, Invoice, Product } from "../types";
import {
  addProductToItems,
  computeLine,
  emptyLine,
  removeInvoiceItem,
  type InvoiceLine,
  VAT_OPTIONS,
} from "../utils/documentLines";
import { itemStripe } from "../utils/workDocs";
import {
  applyTradeKind,
  CURRENCIES,
  defaultInvoiceTypeForFilter,
  draftFromInvoice,
  eTypeForContact,
  emptyInvoiceDraft,
  E_TYPES,
  INCOTERMS,
  INVOICE_TYPES,
  invoicePayload,
  invoiceTotals,
  invoiceUpdateBody,
  parseWithholding,
  plusDaysIso,
  TRADE_KINDS,
  validateInvoiceDraft,
  withholdingSelectGroups,
  withholdingValue,
  type InvoiceDraft,
} from "../utils/invoiceDraft";
import { contactTypeTr } from "../utils/labels";
import { fmtMoney, idOf } from "../utils/money";

type Project = { id?: string; _id?: string; name?: string; project_number?: string };

function Chip({
  label,
  active,
  onPress,
  testID,
  color,
  compact,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  color?: string;
  compact?: boolean;
}) {
  const bg = color || colors.primary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        paddingVertical: compact ? 4 : 8,
        paddingHorizontal: compact ? 8 : 12,
        borderRadius: 999,
        backgroundColor: active ? bg : "#fff",
        borderWidth: 1,
        borderColor: active ? bg : colors.border,
      }}
    >
      <Text style={{ color: active ? "#fff" : colors.text, fontWeight: "700", fontSize: compact ? 11 : 12 }}>{label}</Text>
    </Pressable>
  );
}

function n(v: string): number {
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : 0;
}

export function InvoiceFormScreen({ invoiceId }: { invoiceId?: string }) {
  const { type: filterType, contact_id: preContactId, contact_name: preContactName } = useLocalSearchParams<{
    type?: string;
    contact_id?: string;
    contact_name?: string;
  }>();
  const { client, companyId, can } = useAuth();
  const canEdit = can("/invoices", "edit");
  const isNew = !invoiceId;
  const [draft, setDraft] = useState<InvoiceDraft>(() => ({
    ...emptyInvoiceDraft(),
    ...defaultInvoiceTypeForFilter(String(filterType || "all")),
  }));
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [custQ, setCustQ] = useState("");
  const [prodQ, setProdQ] = useState("");
  const [projQ, setProjQ] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickTax, setQuickTax] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [gibTax, setGibTax] = useState("");
  const [scan, setScan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  const set = <K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const patchLine = (index: number, field: string, value: unknown) => {
    setDraft((d) => ({
      ...d,
      items: d.items.map((it, i) => (i === index ? computeLine({ ...it, [field]: value } as InvoiceLine, field) : it)),
    }));
  };

  const loadLookups = useCallback(async () => {
    try {
      const [c, p, pr] = await Promise.all([
        get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true }),
        get<Product[]>(client, "/products", { company_id: companyId, lite: true }),
        get<Project[]>(client, "/projects", { company_id: companyId }).catch(() => []),
      ]);
      setContacts(c || []);
      setProducts((p || []).filter((x) => x.is_active !== false));
      setProjects(pr || []);
    } catch (err) {
      setError(apiErrorMessage(err, "Cari / stok listesi yüklenemedi."));
    }
  }, [client, companyId]);

  const loadInvoice = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    try {
      const inv = await get<Invoice>(client, `/invoices/${invoiceId}`);
      setDraft(draftFromInvoice(inv));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Fatura yüklenemedi."));
    } finally {
      setLoading(false);
    }
  }, [client, invoiceId]);

  useEffect(() => { loadLookups(); }, [loadLookups]);
  useEffect(() => { loadInvoice(); }, [loadInvoice]);

  useEffect(() => {
    if (!isNew || !preContactId) return;
    const found = contacts.find((c) => idOf(c) === String(preContactId));
    setDraft((d) => {
      if (d.contact_id) return d;
      if (found) {
        const due = found.payment_term_days ? plusDaysIso(d.issue_date, Number(found.payment_term_days)) : d.due_date;
        return {
          ...d,
          contact_id: idOf(found),
          contact_name: found.name,
          e_type: eTypeForContact(d, found.is_e_invoice_user),
          due_date: due,
        };
      }
      if (preContactName) {
        return {
          ...d,
          contact_id: String(preContactId),
          contact_name: String(preContactName),
          e_type: eTypeForContact(d, false),
        };
      }
      return d;
    });
  }, [contacts, isNew, preContactId, preContactName]);

  const custHits = useMemo(() => {
    const q = custQ.trim().toLowerCase();
    if (q.length < 2) return [];
    return contacts
      .filter((c) => [c.name, c.phone, c.tax_number_or_id, c.city].some((v) => String(v || "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [contacts, custQ]);

  const prodHits = useMemo(() => {
    const q = prodQ.trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter((p) => [p.name, p.sku, p.barcode].some((v) => String(v || "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [prodQ, products]);

  const projHits = useMemo(() => {
    const q = projQ.trim().toLowerCase();
    if (!q) return projects.slice(0, 6);
    return projects
      .filter((p) => [p.name, p.project_number].some((v) => String(v || "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [projQ, projects]);

  const totals = invoiceTotals(draft);
  const defaultVat = draft.trade_kind === "export" || draft.e_type === "e_export" ? 0 : 20;
  const withholdingGroups = useMemo(() => withholdingSelectGroups(), []);

  const pickContact = (c: Contact) => {
    const due = c.payment_term_days ? plusDaysIso(draft.issue_date, Number(c.payment_term_days)) : draft.due_date;
    setDraft((d) => ({
      ...d,
      contact_id: idOf(c),
      contact_name: c.name,
      e_type: eTypeForContact(d, c.is_e_invoice_user),
      due_date: due,
    }));
    setCustQ("");
  };

  const addProduct = (p: Product) => {
    setDraft((d) => ({ ...d, items: addProductToItems(d.items, p as unknown as Record<string, unknown>, d.invoice_type, defaultVat) }));
    setProdQ("");
  };

  const lookupBarcode = async (code: string) => {
    const local = products.find((p) => p.barcode === code || p.sku === code);
    if (local) { addProduct(local); return; }
    try {
      const p = await get<Product>(client, `/products/barcode/${encodeURIComponent(code)}`, { company_id: companyId });
      addProduct(p);
    } catch (err) {
      setError(apiErrorMessage(err, "Barkod ile ürün bulunamadı."));
    }
  };

  const createQuickContact = async () => {
    const name = quickName.trim();
    if (!name) { setError("Yeni cari için ad yazın."); return; }
    setBusy(true);
    try {
      const created = await post<Contact>(client, "/contacts", {
        company_id: companyId,
        type: draft.invoice_type === "purchase" ? "supplier" : "customer",
        name,
        tax_number_or_id: quickTax.trim() || "11111111111",
        phone: quickPhone.trim(),
        address: "-",
        city: "-",
      });
      setContacts((prev) => [created, ...prev]);
      pickContact(created);
      setQuickName("");
      setQuickTax("");
      setQuickPhone("");
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Cari oluşturulamadı."));
    } finally {
      setBusy(false);
    }
  };

  const lookupGib = async () => {
    const tid = gibTax.replace(/\D/g, "");
    if (tid.length !== 10 && tid.length !== 11) {
      setError("VKN 10 veya TCKN 11 haneli olmalıdır.");
      return;
    }
    setBusy(true);
    try {
      const r = await get<{
        is_e_invoice_user?: boolean;
        suggested_e_type?: string;
        local_contact?: Contact | null;
        message?: string;
        name?: string;
      }>(client, "/gib/lookup", { tax_id: tid, company_id: companyId });
      if (r.local_contact) {
        pickContact(r.local_contact);
      }
      if (r.suggested_e_type && draft.invoice_type === "sales" && draft.e_type !== "paper") {
        set("e_type", r.suggested_e_type);
      }
      setMessage(r.message || "GİB sorgusu tamamlandı.");
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "GİB sorgusu başarısız."));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const invalid = validateInvoiceDraft(draft);
    if (invalid) { setError(invalid); return; }
    if (!canEdit) { setError("Fatura düzenleme yetkiniz yok."); return; }
    setBusy(true);
    setMessage(null);
    try {
      let saved: Invoice;
      if (isNew) {
        saved = await post<Invoice>(client, "/invoices", invoicePayload(draft, companyId));
        setMessage(draft.status === "draft" ? "Fatura taslak olarak kaydedildi." : "Fatura oluşturuldu ve cariye işlendi.");
      } else {
        saved = await put<Invoice>(client, `/invoices/${invoiceId}`, invoiceUpdateBody(draft));
        if (draft.status === "approved") {
          await post(client, `/invoices/${invoiceId}/approve`);
        }
        setMessage("Taslak fatura güncellendi.");
      }
      setError(null);
      const id = idOf(saved) || invoiceId || "";
      if (id) router.replace({ pathname: "/invoices/[id]", params: { id } });
      else router.back();
    } catch (err) {
      setError(apiErrorMessage(err, "Fatura kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const selectedContact = contacts.find((c) => idOf(c) === draft.contact_id);

  return (
    <Screen onRefresh={isNew ? loadLookups : loadInvoice} refreshing={loading}>
      <H1>{isNew ? "Yeni Fatura Düzenle" : `Taslak Düzenle${draft.contact_name ? ` · ${draft.contact_name}` : ""}`}</H1>
      <Muted>E-Fatura & E-Arşiv standartlarına uygun. Cari ve kalem zorunlu.</Muted>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}

      <Muted>Fatura türü</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {INVOICE_TYPES.map((t) => (
          <Chip
            key={t.key}
            label={t.label}
            active={draft.invoice_type === t.key}
            testID={`inv-type-${t.key}`}
            onPress={() => {
              setDraft((d) => ({
                ...d,
                invoice_type: t.key,
                e_type: t.key === "dispatch" ? "e_dispatch" : d.e_type === "e_dispatch" ? "paper" : d.e_type,
                status: t.key === "dispatch" ? "draft" : d.status,
              }));
            }}
          />
        ))}
      </Row>
      <GroupedSelect
        label="E-belge türü"
        testID="inv-etype-select"
        value={draft.e_type}
        onChange={(v) => set("e_type", v)}
        groups={[{ label: "E-belge", options: E_TYPES.map((t) => ({ value: t.key, label: t.label })) }]}
      />
      <GroupedSelect
        label="Dış ticaret"
        testID="inv-trade-select"
        value={draft.trade_kind}
        onChange={(v) => setDraft((d) => applyTradeKind(d, v))}
        groups={[{ label: "İşlem türü", options: TRADE_KINDS.map((t) => ({ value: t.key, label: t.label })) }]}
      />

      {(draft.trade_kind === "export" || draft.trade_kind === "import") ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>Dış ticaret bilgileri</Text>
          <GroupedSelect
            label="Teslim şekli"
            testID="inv-incoterm-select"
            value={draft.incoterm}
            onChange={(v) => set("incoterm", v)}
            emptyLabel="Seçilmedi"
            groups={[{ label: "Incoterms", options: INCOTERMS.filter(Boolean).map((x) => ({ value: x, label: x })) }]}
          />
          <Field label="Ülke" testID="inv-country" value={draft.country} onChangeText={(v) => set("country", v)} />
          <Field label="Gümrük idaresi" testID="inv-customs" value={draft.customs_office} onChangeText={(v) => set("customs_office", v)} />
          <Field label="Rejim" testID="inv-regime" value={draft.regime_code} onChangeText={(v) => set("regime_code", v)} placeholder="4000 / 1000" />
          <Field label="Beyanname no" testID="inv-declaration" value={draft.declaration_no} onChangeText={(v) => set("declaration_no", v)} />
          <Field label="Beyanname tarihi" testID="inv-declaration-date" value={draft.declaration_date} onChangeText={(v) => set("declaration_date", v)} placeholder="YYYY-MM-DD" />
          {draft.trade_kind === "export" ? <Field label="DAB no" testID="inv-dab" value={draft.dab_no} onChangeText={(v) => set("dab_no", v)} /> : null}
          <Field label="Konşimento / AWB" testID="inv-bl" value={draft.bl_awb} onChangeText={(v) => set("bl_awb", v)} />
          <Field label="Menşe belgesi" testID="inv-certificate" value={draft.certificate} onChangeText={(v) => set("certificate", v)} placeholder="ATR, EUR.1…" />
        </Card>
      ) : null}

      <GroupedSelect
        label="Tevkifat (hizmet faturası)"
        testID="inv-withholding-select"
        value={withholdingValue(draft)}
        onChange={(v) => setDraft((d) => ({ ...d, ...parseWithholding(v) }))}
        groups={withholdingGroups}
      />

      <Muted>Kayıt durumu</Muted>
      <Row>
        <Chip label="Taslak" active={draft.status === "draft"} color="#F59E0B" testID="inv-status-draft" onPress={() => set("status", "draft")} />
        <Chip label="Onaylı (cariye işle)" active={draft.status === "approved"} testID="inv-status-approved" onPress={() => draft.invoice_type !== "dispatch" && set("status", "approved")} />
      </Row>

      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Cari</Text>
        {draft.contact_id ? (
          <ListRow
            title={draft.contact_name || selectedContact?.name || "Cari"}
            subtitle={[contactTypeTr(selectedContact?.type), selectedContact?.tax_number_or_id].filter(Boolean).join(" · ") || "Değiştirmek için dokunun"}
            onPress={() => { set("contact_id", ""); set("contact_name", ""); }}
          />
        ) : (
          <>
            <Field label="Cari ara" testID="inv-contact-search" value={custQ} onChangeText={setCustQ} placeholder="Ad / VKN / telefon" />
            {custHits.map((c) => (
              <ListRow key={idOf(c)} title={c.name} subtitle={`${contactTypeTr(c.type)} · VKN ${c.tax_number_or_id || "—"}`} onPress={() => pickContact(c)} />
            ))}
            <Muted>+ Yeni cari ekle</Muted>
            <Field label="Cari adı" testID="inv-quick-name" value={quickName} onChangeText={setQuickName} />
            <Field label="VKN / TCKN" testID="inv-quick-tax" value={quickTax} onChangeText={setQuickTax} keyboardType="number-pad" />
            <Field label="Telefon" testID="inv-quick-phone" value={quickPhone} onChangeText={setQuickPhone} keyboardType="phone-pad" />
            <PrimaryButton title="Cari oluştur ve seç" onPress={createQuickContact} loading={busy} color={colors.primary} testID="inv-quick-save" />
            <Muted>GİB mükellef sorgusu</Muted>
            <Field label="VKN / TCKN" testID="inv-gib-tax" value={gibTax} onChangeText={setGibTax} keyboardType="number-pad" />
            <PrimaryButton title="GİB'de sorgula" onPress={lookupGib} loading={busy} color={colors.indigo} testID="inv-gib-lookup" />
          </>
        )}
      </Card>

      <Field label="Proje (opsiyonel)" testID="inv-project-search" value={projQ} onChangeText={setProjQ} placeholder="Proje ara" />
      {draft.project_id ? (
        <ListRow title={draft.project_number || draft.project_id} subtitle="Projesiz yapmak için dokunun" onPress={() => { set("project_id", ""); set("project_number", ""); }} />
      ) : projHits.map((p) => (
        <ListRow key={idOf(p)} title={`${p.project_number || ""} · ${p.name || ""}`.trim()} onPress={() => { set("project_id", idOf(p)); set("project_number", p.project_number || ""); setProjQ(""); }} />
      ))}

      <Field label="Düzenleme tarihi" testID="inv-issue-date" value={draft.issue_date} onChangeText={(v) => set("issue_date", v)} placeholder="YYYY-MM-DD" />
      <Field label="Vade tarihi" testID="inv-due-date" value={draft.due_date} onChangeText={(v) => set("due_date", v)} placeholder="YYYY-MM-DD" />
      <Muted>Para birimi</Muted>
      <Row style={{ flexWrap: "wrap" }}>
        {CURRENCIES.map((c) => (
          <Chip key={c} label={c} active={draft.currency === c} onPress={() => setDraft((d) => ({ ...d, currency: c, fx_source: c === "TRY" ? "try" : d.fx_source, fx_rate: c === "TRY" ? 1 : d.fx_rate }))} />
        ))}
      </Row>
      {draft.currency !== "TRY" ? (
        <Field label="Kur (₺)" testID="inv-fx-rate" value={String(draft.fx_rate || "")} onChangeText={(v) => set("fx_rate", n(v))} keyboardType="decimal-pad" />
      ) : null}

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontWeight: "800", color: colors.text }}>Fatura kalemleri</Text>
          <PrimaryButton title="Barkod" onPress={() => setScan(true)} testID="inv-scan" />
        </Row>
        <Field label="Ürün ara ve ekle" testID="inv-prod-search" value={prodQ} onChangeText={setProdQ} placeholder="Ad / SKU / barkod" />
        {prodHits.map((p) => (
          <ProductPickRow key={idOf(p)} product={p} onPress={() => addProduct(p)} />
        ))}
        {draft.items.map((it, idx) => (
          <View
            key={idx}
            style={{ ...itemStripe(idx), borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}
            testID={`inv-item-${idx}`}
          >
            <Row style={{ alignItems: "center", gap: 6 }}>
              <Chip
                compact
                label={it.is_service ? "Hizmet" : "Ürün"}
                active
                color={it.is_service ? colors.indigo : colors.primary}
                testID={`inv-item-kind-${idx}`}
                onPress={() => {
                  setDraft((d) => ({
                    ...d,
                    items: d.items.map((row, i) => {
                      if (i !== idx) return row;
                      const is_service = !row.is_service;
                      return computeLine({ ...row, is_service, product_id: is_service ? "" : row.product_id });
                    }),
                  }));
                }}
              />
              <Pressable
                onPress={() => setDraft((d) => ({ ...d, items: removeInvoiceItem(d.items, idx, defaultVat) }))}
                testID={`inv-item-del-${idx}`}
                accessibilityLabel="Kalemi sil"
                style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", marginLeft: "auto" }}
              >
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            </Row>
            <Row style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 6 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Field
                  compact
                  label={it.is_service ? "Hizmet adı" : "Ad"}
                  testID={`inv-item-name-${idx}`}
                  value={it.name}
                  onChangeText={(v) => patchLine(idx, "name", v)}
                />
              </View>
              <View style={{ width: 52, flexShrink: 0 }}>
                <Field compact label="Miktar" testID={`inv-item-qty-${idx}`} value={String(it.quantity)} onChangeText={(v) => patchLine(idx, "quantity", n(v))} keyboardType="decimal-pad" />
              </View>
              <View style={{ width: 68, flexShrink: 0 }}>
                <Field compact label="Fiyat" testID={`inv-item-price-${idx}`} value={String(it.unit_price)} onChangeText={(v) => patchLine(idx, "unit_price", n(v))} keyboardType="decimal-pad" />
              </View>
            </Row>
            <Row style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 6 }}>
              <View style={{ width: 58, flexShrink: 0 }}>
                <Field compact label="Birim" testID={`inv-item-unit-${idx}`} value={it.unit} onChangeText={(v) => patchLine(idx, "unit", v)} />
              </View>
              <View style={{ width: 68, flexShrink: 0 }}>
                <Field compact label="KDV'li" testID={`inv-item-price-incl-${idx}`} value={String(it.unit_price_incl)} onChangeText={(v) => patchLine(idx, "unit_price_incl", n(v))} keyboardType="decimal-pad" />
              </View>
              <View style={{ width: 52, flexShrink: 0 }}>
                <Field compact label="İsk %" testID={`inv-item-disc-${idx}`} value={String(it.discount_rate)} onChangeText={(v) => patchLine(idx, "discount_rate", n(v))} keyboardType="decimal-pad" />
              </View>
            </Row>
            <Row style={{ flexWrap: "wrap", gap: 4, alignItems: "center" }}>
              {VAT_OPTIONS.map((v) => (
                <Chip compact key={v} label={`%${v}`} active={Number(it.vat_rate) === v} onPress={() => patchLine(idx, "vat_rate", v)} />
              ))}
              <Muted>{`${fmtMoney(it.total, draft.currency)} hariç · ${fmtMoney(it.total_incl, draft.currency)} dahil`}</Muted>
            </Row>
            {(draft.trade_kind === "export" || draft.trade_kind === "import") ? (
              <Row style={{ gap: 6 }}>
                <View style={{ flex: 1 }}>
                  <Field compact label="GTIP" testID={`inv-item-gtip-${idx}`} value={it.gtip || ""} onChangeText={(v) => patchLine(idx, "gtip", v)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Field compact label="Menşe" testID={`inv-item-origin-${idx}`} value={it.origin_country || ""} onChangeText={(v) => patchLine(idx, "origin_country", v)} />
                </View>
              </Row>
            ) : null}
          </View>
        ))}
        <PrimaryButton
          title="Satır ekle"
          color={colors.indigo}
          testID="inv-add-line"
          onPress={() => setDraft((d) => ({ ...d, items: [...d.items, computeLine(emptyLine({ vat_rate: defaultVat }))] }))}
        />
      </Card>

      <Card>
        <Text style={{ fontWeight: "800", color: colors.text }}>Toplamlar</Text>
        <Row style={{ justifyContent: "space-between" }}><Muted>Mal / hizmet</Muted><Text style={{ fontWeight: "700" }}>{fmtMoney(totals.itemsSum, draft.currency)}</Text></Row>
        {totals.lineDiscount > 0 ? (
          <Row style={{ justifyContent: "space-between" }}><Muted>Satır iskontoları</Muted><Text style={{ fontWeight: "700", color: colors.danger }}>-{fmtMoney(totals.lineDiscount, draft.currency)}</Text></Row>
        ) : null}
        <Muted>Genel iskonto</Muted>
        <Row>
          <Chip label="%" active={draft.gdMode === "percent"} onPress={() => set("gdMode", "percent")} testID="gd-mode-percent" />
          <Chip label="₺" active={draft.gdMode === "amount"} onPress={() => set("gdMode", "amount")} testID="gd-mode-amount" />
        </Row>
        <Field
          label={draft.gdMode === "percent" ? "Genel iskonto %" : "Genel iskonto tutarı"}
          testID="general-discount-input"
          value={String(draft.gdMode === "percent" ? draft.general_discount_rate || "" : draft.general_discount_amount || "")}
          onChangeText={(v) => set(draft.gdMode === "percent" ? "general_discount_rate" : "general_discount_amount", n(v))}
          keyboardType="decimal-pad"
        />
        {totals.gd > 0 ? (
          <Row style={{ justifyContent: "space-between" }}><Muted>Genel iskonto</Muted><Text style={{ fontWeight: "700", color: colors.danger }}>-{fmtMoney(totals.gd, draft.currency)}</Text></Row>
        ) : null}
        <Row style={{ justifyContent: "space-between" }}><Muted>Ara toplam</Muted><Text style={{ fontWeight: "700" }}>{fmtMoney(totals.subtotal, draft.currency)}</Text></Row>
        <Row style={{ justifyContent: "space-between" }}><Muted>Toplam KDV</Muted><Text style={{ fontWeight: "700" }}>{fmtMoney(totals.vat, draft.currency)}</Text></Row>
        {totals.withholding > 0 ? (
          <Row style={{ justifyContent: "space-between" }}><Muted>Tevkifat</Muted><Text style={{ fontWeight: "700", color: colors.indigo }}>-{fmtMoney(totals.withholding, draft.currency)}</Text></Row>
        ) : null}
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontSize: 18, fontWeight: "800" }}>{totals.withholding > 0 ? "Ödenecek" : "Genel toplam"}</Text>
          <Text style={{ fontSize: 18, fontWeight: "800", color: colors.primary }} testID="inv-grand-total">{fmtMoney(totals.grandTotal, draft.currency)}</Text>
        </Row>
      </Card>

      <Field label="Not" testID="inv-notes" value={draft.notes} onChangeText={(v) => set("notes", v)} />
      <PrimaryButton
        title={busy ? "Kaydediliyor…" : draft.status === "draft" ? "Taslak Olarak Kaydet" : "Faturayı Kaydet & Onayla"}
        onPress={save}
        loading={busy}
        disabled={!canEdit}
        color={colors.primary}
        testID="save-invoice-btn"
      />
      <BarcodeScannerModal visible={scan} onClose={() => setScan(false)} onScan={lookupBarcode} />
    </Screen>
  );
}
