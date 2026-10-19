import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { ApiHttpError } from "../api/errors";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { BarcodeScannerModal } from "../components/BarcodeScannerModal";
import { DateField } from "../components/DateField";
import { GroupedSelect } from "../components/GroupedSelect";
import { InvoiceLineSheet } from "../components/InvoiceLineSheet";
import { InvoiceProductSheet } from "../components/InvoiceProductSheet";
import { confirmAction } from "../components/chips";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { MoneyInput } from "../components/MoneyInput";
import { colors } from "../theme";
import type { Contact, Invoice, Product } from "../types";
import {
  addProductToItems,
  canRemoveInvoiceLine,
  commitProductLine,
  computeLine,
  emptyLine,
  invoiceBarcodeMiss,
  lineHasContent,
  matchProductVariant,
  removeInvoiceItem,
  type InvoiceLine,
} from "../utils/documentLines";
import {
  fetchLineProductHits,
  fillInvoiceLineFromProduct,
  findCatalogProduct,
  findInvoiceProductByScan,
  lineBarcodeLookupRequest,
  lineProductDetailRequest,
  lineProductNeedsHydrate,
  type LineProductHit,
} from "../utils/lineProductSearch";
import {
  applyTradeKind,
  canDeleteInvoice,
  CURRENCIES,
  defaultInvoiceTypeForFilter,
  draftFromInvoice,
  eTypeForContact,
  emptyInvoiceDraft,
  E_TYPES,
  INCOTERMS,
  invoiceDeleteConfirmMessage,
  invoicePayload,
  invoiceProjectSelectGroups,
  invoiceTotals,
  invoiceUpdateBody,
  parseWithholding,
  plusDaysIso,
  TRADE_KINDS,
  validateInvoiceDraft,
  WITHHOLDING,
  withholdingSelectGroups,
  withholdingValue,
  type InvoiceDraft,
} from "../utils/invoiceDraft";
import { paymentTargetGroups, splitPaymentTarget, type BankAccount, type Partner } from "../utils/finance";
import {
  findRetailContact,
  invoiceFormPatchForRetail,
  retailContactCreatePayload,
} from "../utils/barcodeSale";
import { contactTypeTr } from "../utils/labels";
import {
  invoiceProductPageQuery,
  invoiceScanStrip,
  productsFromIdsPayload,
  rememberFrequentInvoiceProducts,
  upsertProducts,
} from "../utils/invoiceProductPick";
import { lineItemImage } from "../utils/productDisplay";
import { fmtMoney, idOf } from "../utils/money";

type Project = { id?: string; _id?: string; name?: string; project_number?: string };
type FormStatus = "loading" | "ready" | "error";

const TYPE_SEGMENT = [
  { key: "sales", label: "Satış" },
  { key: "purchase", label: "Alış" },
  { key: "return", label: "İade" },
  { key: "proforma", label: "Proforma" },
] as const;

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

export function InvoiceFormScreen({ invoiceId }: { invoiceId?: string }) {
  const { type: filterType, contact_id: preContactId, contact_name: preContactName } = useLocalSearchParams<{
    type?: string;
    contact_id?: string;
    contact_name?: string;
  }>();
  const { client, companyId, can } = useAuth();
  const canEdit = can("/invoices", "edit");
  const canDelete = can("/invoices", "delete");
  const isNew = !invoiceId;
  const [draft, setDraft] = useState<InvoiceDraft>(() => ({
    ...emptyInvoiceDraft(),
    ...defaultInvoiceTypeForFilter(String(filterType || "all")),
  }));
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [payAccount, setPayAccount] = useState("");
  const [custQ, setCustQ] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickTax, setQuickTax] = useState("");
  const [quickPhone, setQuickPhone] = useState("");
  const [gibTax, setGibTax] = useState("");
  const [scan, setScan] = useState(false);
  const [scanLine, setScanLine] = useState<number | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [scanBanner, setScanBanner] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const productsRef = useRef(products);
  productsRef.current = products;
  const draftRef = useRef(draft);
  const itemsRef = useRef(draft.items);
  draftRef.current = draft;
  itemsRef.current = draft.items;
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formStatus, setFormStatus] = useState<FormStatus>(isNew ? "ready" : "loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState<Invoice | null>(null);
  const [dirty, setDirty] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [sheetIndex, setSheetIndex] = useState<number | null>(null);
  const formStatusRef = useRef<FormStatus>(isNew ? "ready" : "loading");
  const baseRef = useRef("");
  const sheetIndexRef = useRef<number | null>(null);
  const sheetApplyRef = useRef<((line: InvoiceLine) => void) | null>(null);
  const sheetLineRef = useRef<InvoiceLine | null>(null);
  sheetIndexRef.current = sheetIndex;
  const reportSheetLine = useCallback((line: InvoiceLine) => { sheetLineRef.current = line; }, []);
  const bindSheetApply = useCallback((apply: ((line: InvoiceLine) => void) | null) => { sheetApplyRef.current = apply; }, []);

  const set = <K extends keyof InvoiceDraft>(key: K, value: InvoiceDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const loadLookups = useCallback(async () => {
    try {
      const [c, pr, acc, pars] = await Promise.all([
        get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true }),
        get<Project[]>(client, "/projects", { company_id: companyId }).catch(() => []),
        get<BankAccount[]>(client, "/banking/accounts", { company_id: companyId }).catch(() => []),
        get<Partner[]>(client, "/banking/partners", { company_id: companyId }).catch(() => []),
      ]);
      setContacts(c || []);
      setProjects(pr || []);
      setAccounts(acc || []);
      setPartners((pars || []).filter((x) => x.is_active !== false));
    } catch (err) {
      setError(apiErrorMessage(err, "Cari listesi yüklenemedi."));
    }
  }, [client, companyId]);

  const loadInvoice = useCallback(async () => {
    if (!invoiceId) return;
    const first = formStatusRef.current !== "ready";
    if (first) {
      formStatusRef.current = "loading";
      setFormStatus("loading");
    } else {
      setRefreshing(true);
    }
    try {
      const inv = await get<Invoice>(client, `/invoices/${invoiceId}`);
      const next = draftFromInvoice(inv);
      baseRef.current = JSON.stringify(next);
      setLoaded(inv);
      setDraft(next);
      setDirty(false);
      setError(null);
      formStatusRef.current = "ready";
      setFormStatus("ready");
    } catch (err) {
      setError(apiErrorMessage(err, "Fatura yüklenemedi."));
      if (formStatusRef.current !== "ready") {
        formStatusRef.current = "error";
        setFormStatus("error");
      }
    } finally {
      setRefreshing(false);
    }
  }, [client, invoiceId]);

  useEffect(() => { loadLookups(); }, [loadLookups]);
  useEffect(() => { loadInvoice(); }, [loadInvoice]);

  useEffect(() => {
    if (!isNew && formStatus !== "ready") return;
    const snap = JSON.stringify(draft);
    if (!baseRef.current) {
      baseRef.current = snap;
      setDirty(false);
      return;
    }
    setDirty(snap !== baseRef.current);
  }, [draft, formStatus, isNew]);

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

  const lineProductKey = useMemo(
    () => [...new Set(draft.items.map((it) => String(it.product_id || "").trim()).filter(Boolean))].sort().join(","),
    [draft.items],
  );

  useEffect(() => {
    if (!isNew && formStatus !== "ready") return;
    const missing = lineProductKey.split(",").filter(Boolean).filter((id) => !productsRef.current.some((p) => idOf(p) === id));
    if (!missing.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await get(client, "/products", { company_id: companyId, lite: 1, ids: missing.join(",") });
        if (cancelled) return;
        setProducts((prev) => upsertProducts(prev, productsFromIdsPayload(raw)));
      } catch {
        /* satır görseli kart gelince dolar */
      }
    })();
    return () => { cancelled = true; };
  }, [client, companyId, formStatus, isNew, lineProductKey]);

  const custHits = useMemo(() => {
    const q = custQ.trim().toLowerCase();
    if (q.length < 2) return [];
    return contacts
      .filter((c) => [c.name, c.phone, c.tax_number_or_id, c.city].some((v) => String(v || "").toLowerCase().includes(q)))
      .slice(0, 8);
  }, [contacts, custQ]);

  const projectGroups = useMemo(() => invoiceProjectSelectGroups(projects), [projects]);
  const totals = invoiceTotals(draft);
  const defaultVat = draft.trade_kind === "export" || draft.e_type === "e_export" ? 0 : 20;
  const withholdingGroups = useMemo(() => withholdingSelectGroups(), []);
  const canCollectCash = draft.invoice_type === "sales" || draft.invoice_type === "purchase" || draft.invoice_type === "return";
  const payGroups = useMemo(
    () => paymentTargetGroups(accounts, partners, { collectableOnly: draft.invoice_type === "sales" }),
    [accounts, partners, draft.invoice_type],
  );
  const cashAccountLabel =
    draft.invoice_type === "purchase" ? "Peşin alış hesabı" : draft.invoice_type === "return" ? "İade hesabı" : "Peşin satış hesabı";

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
    setContactOpen(false);
  };

  const pickRetailContact = async () => {
    setBusy(true);
    setError(null);
    try {
      let retail = findRetailContact(contacts);
      if (!retail) {
        retail = await post<Contact>(client, "/contacts", retailContactCreatePayload(companyId));
        setContacts((prev) => [retail as Contact, ...prev]);
      }
      const patch = invoiceFormPatchForRetail(retail, draft);
      setDraft((d) => ({
        ...d,
        contact_id: patch.contact_id,
        contact_name: patch.contact_name,
        e_type: (patch.e_type as typeof d.e_type) || d.e_type,
      }));
      setCustQ("");
      setContactOpen(false);
    } catch (err) {
      setError(apiErrorMessage(err, "Perakende cari seçilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const rememberProducts = (rows: Product[]) => {
    setProducts((prev) => upsertProducts(prev, rows));
    void rememberFrequentInvoiceProducts(companyId, rows);
  };

  const addScannedProduct = (product: Product, code: string) => {
    const current = draftRef.current;
    const result = commitProductLine(itemsRef.current, product as unknown as Record<string, unknown>, current.invoice_type, {
      exportInvoice: current.trade_kind === "export" || current.e_type === "e_export",
      scanCode: code,
    });
    const next = { ...current, items: result.items };
    draftRef.current = next;
    itemsRef.current = result.items;
    setDraft(next);
    setScanError(null);
    setError(null);
    setScanBanner(invoiceScanStrip(result));
    rememberProducts([product]);
  };

  const lookupBarcode = async (code: string) => {
    const c = String(code || "").trim();
    if (!c) return;
    try {
      const req = lineBarcodeLookupRequest(companyId, c);
      const product = await get<Product>(client, req.path, req.query);
      addScannedProduct(product, c);
    } catch (err) {
      const status = err instanceof ApiHttpError ? err.status : 0;
      const local = status === 404 ? undefined : findInvoiceProductByScan(productsRef.current, c);
      if (local) {
        addScannedProduct(local, c);
        return;
      }
      setMessage(null);
      setScanBanner(null);
      setScanError(invoiceBarcodeMiss(c));
    }
  };

  const searchInvoiceProducts = useCallback((q: string, page: number) => (
    get(client, "/products", invoiceProductPageQuery({ companyId, q, page }))
  ), [client, companyId]);

  const fetchProductsByIds = useCallback((ids: string[]) => (
    get(client, "/products", { company_id: companyId, lite: 1, ids: ids.join(",") })
  ), [client, companyId]);

  const addPickedProducts = (picks: Array<{ product: Product; quantity: number }>) => {
    const current = draftRef.current;
    let items = itemsRef.current;
    const exportOn = current.trade_kind === "export" || current.e_type === "e_export";
    for (const pick of picks) {
      const qty = Math.max(0, Math.round(Number(pick.quantity) || 0));
      for (let n = 0; n < qty; n += 1) {
        items = addProductToItems(items, pick.product as unknown as Record<string, unknown>, current.invoice_type, { exportInvoice: exportOn });
      }
    }
    const next = { ...current, items };
    draftRef.current = next;
    itemsRef.current = items;
    setDraft(next);
    rememberProducts(picks.map((pick) => pick.product));
    setPickOpen(false);
    setScan(false);
  };

  const openManualLine = (service: boolean) => {
    const current = draftRef.current;
    const vat = current.trade_kind === "export" || current.e_type === "e_export" ? 0 : 20;
    const idx = current.items.findIndex((it) => !lineHasContent(it));
    let items = current.items;
    let index = idx;
    if (idx >= 0) {
      if (!!current.items[idx].is_service !== service) {
        items = current.items.map((it, i) => (
          i === idx ? computeLine({ ...it, is_service: service, product_id: "", vat_rate: vat }) : it
        ));
      }
    } else {
      items = [...current.items, computeLine(emptyLine({ vat_rate: vat, is_service: service }))];
      index = items.length - 1;
    }
    if (items !== current.items) {
      const next = { ...current, items };
      draftRef.current = next;
      itemsRef.current = items;
      setDraft(next);
    }
    setSheetIndex(index);
    setPickOpen(false);
    setScan(false);
    setScanLine(null);
  };

  const closePick = () => {
    setPickOpen(false);
    setScan(false);
    setScanBanner(null);
    setScanError(null);
  };

  const loadLineHits = useCallback(
    async (q: string) =>
      fetchLineProductHits({
        search: (path, query) => get(client, path, query),
        companyId,
        query: q,
        catalog: productsRef.current,
      }),
    [client, companyId],
  );

  const resolveLineProduct = async (hit: LineProductHit | Product): Promise<Product> => {
    const fromCat = findCatalogProduct(productsRef.current, hit);
    const candidate = (fromCat || hit) as Product;
    if (!lineProductNeedsHydrate(candidate)) return candidate;
    const pid = idOf(candidate);
    if (!pid) return candidate;
    try {
      return await get<Product>(client, lineProductDetailRequest(pid).path);
    } catch {
      return candidate;
    }
  };

  const pickLineProduct = async (index: number, hit: LineProductHit | Product, scanCode?: string) => {
    const full = await resolveLineProduct(hit);
    const code = String(scanCode || "").trim();
    const variant = code ? matchProductVariant(full, code) : undefined;
    setProducts((prev) => upsertProducts(prev, [full]));
    setDraft((d) => {
      const base = sheetIndexRef.current === index && sheetLineRef.current ? sheetLineRef.current : d.items[index];
      const next = fillInvoiceLineFromProduct(base, full, d.invoice_type, {
        exportInvoice: d.trade_kind === "export" || d.e_type === "e_export",
        variant,
      });
      if (sheetIndexRef.current === index && sheetApplyRef.current) {
        sheetApplyRef.current(next);
        return d;
      }
      return { ...d, items: d.items.map((it, i) => (i === index ? next : it)) };
    });
    if (code) {
      const name = variant ? `${full.name} - ${variant.name || ""}` : full.name;
      setMessage(`${name} eklendi`);
      setError(null);
    }
  };

  const applyBarcodeToLine = async (code: string) => {
    const index = scanLine;
    setScanLine(null);
    if (index == null) return;
    const c = String(code || "").trim();
    const local = findInvoiceProductByScan(productsRef.current, c);
    if (local) {
      await pickLineProduct(index, local, c);
      return;
    }
    try {
      const req = lineBarcodeLookupRequest(companyId, c);
      const p = await get<Product>(client, req.path, req.query);
      await pickLineProduct(index, p, c);
    } catch {
      setMessage(null);
      setError(invoiceBarcodeMiss(c));
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

  const persist = async (status: "draft" | "approved") => {
    const invalid = validateInvoiceDraft(draft);
    if (invalid) { setError(invalid); return null; }
    if (!canEdit) { setError("Fatura düzenleme yetkiniz yok."); return null; }
    const next = { ...draft, status: draft.invoice_type === "dispatch" ? "draft" : status };
    if (isNew) {
      return post<Invoice>(client, "/invoices", invoicePayload(next, companyId));
    }
    const saved = await put<Invoice>(client, `/invoices/${invoiceId}`, invoiceUpdateBody(next));
    if (next.status === "approved") {
      await post(client, `/invoices/${invoiceId}/approve`);
    }
    return saved;
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await persist(draft.status === "approved" ? "approved" : "draft");
      if (!saved) return;
      setMessage(draft.status === "draft" ? "Fatura taslak olarak kaydedildi." : "Fatura oluşturuldu ve cariye işlendi.");
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

  const issue = () => {
    const isDispatch = draft.invoice_type === "dispatch";
    const cash = canCollectCash && payAccount && totals.grandTotal > 0;
    const cashHint = cash
      ? draft.invoice_type === "purchase"
        ? " Peşin tutar seçilen hesaptan düşülecek."
        : " Peşin tutar seçilen hesaba aktarılacak."
      : "";
    confirmAction(
      isDispatch ? "İrsaliye kes" : "Fatura kes",
      (isDispatch ? "İrsaliye kaydedilip GİB'e kesilsin mi?" : "Fatura onaylanıp GİB'e kesilsin mi?") + cashHint,
      async () => {
        setBusy(true);
        setMessage(null);
        try {
          const saved = await persist(isDispatch ? "draft" : "approved");
          if (!saved) return;
          const id = idOf(saved) || invoiceId || "";
          if (!id) throw new Error("Fatura kaydı oluşmadı.");
          const eType = isDispatch ? "e_dispatch" : draft.e_type;
          await post(client, `/invoices/${id}/send-to-gib`, { e_type: eType });
          let issuedMsg = isDispatch ? "İrsaliye kesildi." : "Fatura kesildi.";
          if (cash) {
            try {
              const target = splitPaymentTarget(payAccount);
              await post(client, `/invoices/${id}/record-payment`, {
                amount: totals.grandTotal,
                account_id: target.account_id || undefined,
                partner_id: target.partner_id || undefined,
              });
              issuedMsg = isDispatch ? issuedMsg : "Fatura kesildi, peşin ödeme hesaba aktarıldı.";
            } catch (payErr) {
              setError(apiErrorMessage(payErr, "Fatura kesildi ancak peşin ödeme aktarılamadı."));
              setMessage(issuedMsg);
              router.replace({ pathname: "/invoices/[id]", params: { id } });
              return;
            }
          }
          setError(null);
          setMessage(issuedMsg);
          router.replace({ pathname: "/invoices/[id]", params: { id } });
        } catch (err) {
          setError(apiErrorMessage(err, "Fatura kesilemedi."));
        } finally {
          setBusy(false);
        }
      },
    );
  };

  const selectedContact = contacts.find((c) => idOf(c) === draft.contact_id);
  const sheetLine = sheetIndex != null ? draft.items[sheetIndex] : null;
  const sheetProduct = sheetLine?.product_id ? products.find((p) => idOf(p) === sheetLine.product_id) : undefined;
  const projectLabel = draft.project_number
    || projects.find((p) => idOf(p) === draft.project_id)?.name
    || "Projesiz";
  const withholdingLabel = WITHHOLDING.find((w) => w.value === withholdingValue(draft))?.label || "Tevkifat yok";
  const fxLabel = draft.currency === "TRY" ? draft.currency : `${draft.currency} · Kur ${draft.fx_rate || 1}`;
  const termDays = selectedContact?.payment_term_days;
  const showContactSearch = !draft.contact_id || contactOpen;
  const locked = !isNew && formStatus !== "ready";
  const saveTitle = busy ? "Kaydediliyor…" : draft.status === "draft" ? "Taslak kaydet" : "Kaydet & Onayla";
  const issueTitle = busy ? "Kesiliyor…" : draft.invoice_type === "dispatch" ? "İrsaliye Kes" : "⚡ Faturalaştır";
  const showDelete = !!invoiceId && !!loaded && loaded.status === "draft" && canDelete && canDeleteInvoice(loaded);

  const selectType = (key: string) => {
    setDraft((d) => ({
      ...d,
      invoice_type: key,
      e_type: key === "dispatch" ? "e_dispatch" : d.e_type === "e_dispatch" ? "paper" : d.e_type,
      status: key === "dispatch" ? "draft" : d.status,
    }));
  };

  const removeDraft = () => {
    if (!showDelete || !invoiceId || !loaded) return;
    confirmAction("Faturayı sil", invoiceDeleteConfirmMessage(loaded), async () => {
      setBusy(true);
      try {
        await del(client, `/invoices/${invoiceId}`);
        router.back();
      } catch (err) {
        setError(apiErrorMessage(err, "Silinemedi."));
      } finally {
        setBusy(false);
      }
    });
  };

  const removeLine = (idx: number) => {
    if (!canRemoveInvoiceLine(draft.items, idx)) {
      setError("En az bir kalem gerekli.");
      return;
    }
    const label = draft.items[idx]?.name || draft.items[idx]?.product_name || "Kalem";
    confirmAction("Kalemi sil", `${label} satırı silinsin mi?`, () => {
      setDraft((d) => ({ ...d, items: removeInvoiceItem(d.items, idx, defaultVat) }));
      if (sheetIndex === idx) setSheetIndex(null);
    });
  };

  const actionBar = (
    <View style={{ flexDirection: "row", alignItems: "stretch", gap: 8 }}>
      <View style={{ flex: 1 }}>
        <PrimaryButton
          title={saveTitle}
          onPress={save}
          loading={busy}
          disabled={locked || !canEdit}
          color={colors.slate800}
          testID="save-invoice-btn"
        />
      </View>
      <View style={{ flex: 1.7 }}>
        <PrimaryButton
          title={issueTitle}
          onPress={issue}
          loading={busy}
          disabled={locked || !canEdit}
          color="#F59E0B"
          testID="issue-invoice-btn"
        />
      </View>
    </View>
  );

  if (!isNew && formStatus === "loading") {
    return (
      <Screen stickyBottom={actionBar}>
        <View testID="inv-form-loading" style={{ gap: 8 }}>
          <View style={{ height: 28, width: 180, borderRadius: 8, backgroundColor: "#E2E8F0" }} />
          <View style={{ height: 88, borderRadius: 16, backgroundColor: "#E2E8F0" }} />
          <View style={{ height: 120, borderRadius: 16, backgroundColor: "#E2E8F0" }} />
          <Muted>Yükleniyor…</Muted>
        </View>
      </Screen>
    );
  }

  if (!isNew && formStatus === "error") {
    return (
      <Screen onRefresh={loadInvoice}>
        <ErrorBanner message={error || "Fatura yüklenemedi."} />
        <PrimaryButton title="Tekrar dene" onPress={() => { void loadInvoice(); }} testID="inv-form-retry" color={colors.primary} />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={isNew ? loadLookups : loadInvoice} refreshing={refreshing} stickyBottom={actionBar}>
      <H1>{isNew ? "Yeni Fatura" : `${draft.status === "draft" ? "Taslak Düzenle" : "Fatura Düzenle"}${draft.contact_name ? ` · ${draft.contact_name}` : ""}`}</H1>
      {dirty ? (
        <View testID="inv-dirty" style={{ backgroundColor: "#FFFBEB", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text style={{ color: "#B45309", fontWeight: "800" }}>● Kaydedilmemiş değişiklik var</Text>
        </View>
      ) : null}
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}

      <SectionTitle title="TÜR" />
      <Card>
        <View style={{ flexDirection: "row", backgroundColor: colors.slate100, borderRadius: 12, padding: 4 }}>
          {TYPE_SEGMENT.map((t) => {
            const active = draft.invoice_type === t.key;
            return (
              <Pressable
                key={t.key}
                testID={`inv-type-${t.key}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => selectType(t.key)}
                style={{ flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: active ? "#fff" : "transparent" }}
              >
                <Text style={{ fontWeight: "800", fontSize: 13, color: active ? colors.text : colors.muted }}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Row style={{ flexWrap: "wrap", marginTop: 8 }}>
          <Chip label="İrsaliye" active={draft.invoice_type === "dispatch"} color="#D97706" testID="inv-type-dispatch" onPress={() => selectType("dispatch")} />
          <Chip label="İhracat" active={draft.trade_kind === "export"} color="#0EA5E9" testID="inv-trade-export" onPress={() => setDraft((d) => applyTradeKind(d, "export"))} />
          <Chip label="İthalat" active={draft.trade_kind === "import"} color={colors.indigo} testID="inv-trade-import" onPress={() => setDraft((d) => applyTradeKind(d, "import"))} />
        </Row>
        <GroupedSelect
          dense
          label="E-belge türü"
          testID="inv-etype-select"
          value={draft.e_type}
          onChange={(v) => set("e_type", v)}
          groups={[{ label: "E-belge", options: E_TYPES.map((t) => ({ value: t.key, label: t.label })) }]}
        />
        <GroupedSelect
          dense
          label="Yurt içi / Dış ticaret"
          testID="inv-trade-select"
          value={draft.trade_kind}
          onChange={(v) => setDraft((d) => applyTradeKind(d, v))}
          groups={[{ label: "İşlem türü", options: TRADE_KINDS.map((t) => ({ value: t.key, label: t.label })) }]}
        />
        {(draft.trade_kind === "export" || draft.trade_kind === "import") ? (
          <View>
            <Text style={{ fontWeight: "800", color: colors.text, marginBottom: 6 }}>Dış ticaret bilgileri</Text>
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
          </View>
        ) : null}
      </Card>

      <SectionTitle title="CARİ" />
      <Card>
        {draft.contact_id ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: showContactSearch ? 8 : 0 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={{ fontWeight: "800", fontSize: 16, color: colors.text }}>{draft.contact_name || selectedContact?.name || "Cari"}</Text>
              <Muted>
                {`VKN ${selectedContact?.tax_number_or_id || "—"} · ${selectedContact ? (selectedContact.is_e_invoice_user ? "e-Fatura kullanıcısı" : "e-Fatura kullanıcısı değil") : "e-Fatura —"} · Vade ${termDays == null ? "—" : `${termDays} gün`}`}
              </Muted>
            </View>
            <Pressable testID="inv-contact-change" onPress={() => setContactOpen((v) => !v)} hitSlop={8}>
              <Text style={{ color: "#B45309", fontWeight: "800" }}>Değiştir</Text>
            </Pressable>
          </View>
        ) : null}
        {showContactSearch ? (
          <View>
            {draft.invoice_type === "sales" ? (
              <PrimaryButton
                title="Perakende müşteri"
                testID="inv-retail-contact-btn"
                color={colors.primary}
                loading={busy}
                onPress={pickRetailContact}
              />
            ) : null}
            <Field label="Cari ara" testID="inv-contact-search" value={custQ} onChangeText={setCustQ} placeholder="Ad / VKN / telefon" />
            {custHits.map((c) => (
              <ListRow
                key={idOf(c)}
                title={c.name}
                subtitle={`${contactTypeTr(c.type)} · VKN ${c.tax_number_or_id || "—"}`}
                onPress={() => { pickContact(c); setContactOpen(false); }}
                testID={/perakende/i.test(c.name || "") ? "inv-retail-contact-option" : undefined}
              />
            ))}
            <Muted>+ Yeni cari ekle</Muted>
            <Field label="Cari adı" testID="inv-quick-name" value={quickName} onChangeText={setQuickName} />
            <Field label="VKN / TCKN" testID="inv-quick-tax" value={quickTax} onChangeText={setQuickTax} keyboardType="number-pad" />
            <Field label="Telefon" testID="inv-quick-phone" value={quickPhone} onChangeText={setQuickPhone} keyboardType="phone-pad" />
            <PrimaryButton title="Cari oluştur ve seç" onPress={createQuickContact} loading={busy} color={colors.primary} testID="inv-quick-save" />
            <Muted>GİB mükellef sorgusu</Muted>
            <Field label="VKN / TCKN" testID="inv-gib-tax" value={gibTax} onChangeText={setGibTax} keyboardType="number-pad" />
            <PrimaryButton title="GİB'de sorgula" onPress={lookupGib} loading={busy} color={colors.indigo} testID="inv-gib-lookup" />
          </View>
        ) : null}
      </Card>

      <SectionTitle title="TARİH" />
      <Card>
        <Row style={{ alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <DateField label="Düzenleme tarihi" testID="inv-issue-date" value={draft.issue_date} onChangeText={(v) => set("issue_date", v)} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="Vade tarihi" testID="inv-due-date" value={draft.due_date} onChangeText={(v) => set("due_date", v)} min={draft.issue_date} />
          </View>
        </Row>
        <Pressable testID="inv-meta-edit" onPress={() => setMetaOpen((v) => !v)} style={{ paddingVertical: 6 }}>
          <Text style={{ fontWeight: "700", color: colors.text }}>{`${fxLabel} · ${projectLabel} · ${withholdingLabel}`}</Text>
          <Muted>{metaOpen ? "Kapat" : "Dokununca düzenlenir"}</Muted>
        </Pressable>
        {metaOpen ? (
          <View>
            <Muted>Para birimi</Muted>
            <Row style={{ flexWrap: "wrap" }}>
              {CURRENCIES.map((c) => (
                <Chip key={c} label={c} active={draft.currency === c} onPress={() => setDraft((d) => ({ ...d, currency: c, fx_source: c === "TRY" ? "try" : d.fx_source, fx_rate: c === "TRY" ? 1 : d.fx_rate }))} />
              ))}
            </Row>
            {draft.currency !== "TRY" ? (
              <MoneyInput label="Kur (₺)" testID="inv-fx-rate" decimals={4} maxFractionDigits={6} value={draft.fx_rate || ""} onChange={(v) => set("fx_rate", v ?? 1)} />
            ) : null}
            <GroupedSelect
              dense
              label="Proje (opsiyonel)"
              testID="inv-project-search"
              value={draft.project_id}
              emptyLabel="Projesiz"
              onChange={(v) => {
                const p = projects.find((row) => idOf(row) === v);
                setDraft((d) => ({ ...d, project_id: v, project_number: p?.project_number || "" }));
              }}
              groups={projectGroups}
            />
            <GroupedSelect
              dense
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
          </View>
        ) : null}
      </Card>

      <SectionTitle
        title={`SATIRLAR · ${draft.items.length}`}
        right={(
          <Pressable
            testID="inv-product-open"
            onPress={() => setPickOpen(true)}
            style={{ backgroundColor: "#FFFBEB", borderRadius: 999, borderWidth: 1, borderColor: "#F59E0B", paddingHorizontal: 10, paddingVertical: 6 }}
          >
            <Text style={{ color: "#B45309", fontWeight: "800" }}>＋ Ürün / Barkod</Text>
          </Pressable>
        )}
      />
      <Card>
        {draft.items.map((it, idx) => (
          <View key={idx} style={{ marginTop: idx ? 8 : 0 }}>
            <Pressable
              testID={`inv-item-${idx}`}
              onPress={() => setSheetIndex(idx)}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, gap: 8, backgroundColor: "#fff" }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text numberOfLines={2} style={{ flex: 1, fontWeight: "800", color: colors.text }}>{it.name || it.product_name || "Kalem"}</Text>
                <Pressable
                  onPress={() => removeLine(idx)}
                  testID={`inv-item-del-${idx}`}
                  accessibilityLabel="Kalemi sil"
                  style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <LineStat label="ADET" value={String(it.quantity)} />
                <LineStat label="FİYAT" value={fmtMoney(it.unit_price, draft.currency)} />
                <LineStat label="KDV" value={`%${it.vat_rate}`} />
                <LineStat label="İSK" value={`%${it.discount_rate || 0}`} />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: colors.muted, fontWeight: "700" }}>{it.unit || "Adet"}</Text>
                <Text style={{ fontWeight: "800", color: colors.text }}>{fmtMoney(it.total_incl, draft.currency)}</Text>
              </View>
            </Pressable>
          </View>
        ))}
      </Card>

      <SectionTitle title="TOPLAMLAR" />
      <Card>
        <Row style={{ justifyContent: "space-between" }}><Muted>Ara toplam</Muted><Text style={{ fontWeight: "700" }}>{fmtMoney(totals.subtotal, draft.currency)}</Text></Row>
        {totals.lineDiscount > 0 ? (
          <Row style={{ justifyContent: "space-between" }}><Muted>Satır iskontoları</Muted><Text style={{ fontWeight: "700", color: colors.danger }}>-{fmtMoney(totals.lineDiscount, draft.currency)}</Text></Row>
        ) : null}
        <Muted>Genel iskonto</Muted>
        <Row>
          <Chip label="%" active={draft.gdMode === "percent"} onPress={() => set("gdMode", "percent")} testID="gd-mode-percent" />
          <Chip label="₺" active={draft.gdMode === "amount"} onPress={() => set("gdMode", "amount")} testID="gd-mode-amount" />
        </Row>
        <MoneyInput
          label={draft.gdMode === "percent" ? "Genel iskonto %" : "Genel iskonto tutarı"}
          testID="general-discount-input"
          value={draft.gdMode === "percent" ? draft.general_discount_rate || "" : draft.general_discount_amount || ""}
          onChange={(v) => set(draft.gdMode === "percent" ? "general_discount_rate" : "general_discount_amount", v ?? 0)}
        />
        {totals.gd > 0 ? (
          <Row style={{ justifyContent: "space-between" }}><Muted>Genel iskonto</Muted><Text style={{ fontWeight: "700", color: colors.danger }}>-{fmtMoney(totals.gd, draft.currency)}</Text></Row>
        ) : null}
        <Row style={{ justifyContent: "space-between" }}><Muted>KDV</Muted><Text style={{ fontWeight: "700" }}>{fmtMoney(totals.vat, draft.currency)}</Text></Row>
        {totals.withholding > 0 ? (
          <Row style={{ justifyContent: "space-between" }}><Muted>Tevkifat</Muted><Text style={{ fontWeight: "700", color: colors.indigo }}>-{fmtMoney(totals.withholding, draft.currency)}</Text></Row>
        ) : null}
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={{ fontSize: 18, fontWeight: "800" }}>{totals.withholding > 0 ? "Ödenecek" : "Genel toplam"}</Text>
          <Text style={{ fontSize: 18, fontWeight: "800", color: "#B45309" }} testID="inv-grand-total">{fmtMoney(totals.grandTotal, draft.currency)}</Text>
        </Row>
      </Card>

      <SectionTitle title="NOT VE ÖDEME" />
      <Card>
        <Field label="Not" testID="inv-notes" value={draft.notes} onChangeText={(v) => set("notes", v)} />
        {canCollectCash ? (
          payGroups.some((g) => g.options.length) ? (
            <GroupedSelect
              dense
              label={cashAccountLabel}
              testID="inv-cash-account-select"
              value={payAccount}
              onChange={setPayAccount}
              emptyLabel="Vadeli — hesap seçilmedi"
              groups={payGroups}
            />
          ) : (
            <Muted>Hesap yok — peşin aktarım için kasa / banka ekleyin. Boş bırakılırsa vadeli kalır.</Muted>
          )
        ) : null}
      </Card>

      {showDelete ? (
        <Pressable onPress={removeDraft} testID="inv-delete" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 }}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: "800" }}>Taslağı sil</Text>
        </Pressable>
      ) : null}

      <BarcodeScannerModal
        visible={scan || scanLine != null}
        continuous={scan && scanLine == null}
        status={scan && scanLine == null ? (scanError || scanBanner) : null}
        onClose={() => { setScan(false); setScanLine(null); }}
        onScan={(code) => {
          if (scanLine != null) void applyBarcodeToLine(code);
          else void lookupBarcode(code);
        }}
      />
      <InvoiceProductSheet
        visible={pickOpen}
        companyId={companyId}
        priceType={draft.invoice_type === "purchase" ? "purchase" : "sales"}
        currency={draft.currency}
        items={draft.items}
        notice={scanError ? { tone: "err", text: scanError } : scanBanner ? { tone: "ok", text: scanBanner } : null}
        search={searchInvoiceProducts}
        fetchByIds={fetchProductsByIds}
        onClose={closePick}
        onAdd={addPickedProducts}
        onScan={() => { setScanError(null); setScanBanner(null); setScan(true); }}
        onFreeLine={() => openManualLine(false)}
        onServiceLine={() => openManualLine(true)}
      />
      {sheetLine ? (
        <InvoiceLineSheet
          key={`line-${sheetIndex}`}
          visible={sheetIndex != null}
          index={sheetIndex ?? 0}
          count={draft.items.length}
          line={sheetLine}
          currency={draft.currency}
          tradeKind={draft.trade_kind}
          allowDelete={sheetIndex != null && canRemoveInvoiceLine(draft.items, sheetIndex)}
          editable={canEdit}
          imageUri={sheetProduct ? lineItemImage(sheetLine as unknown as Record<string, unknown>, { [idOf(sheetProduct)]: sheetProduct }) : ""}
          stockQty={sheetProduct?.stock_quantity}
          productUnit={sheetProduct?.unit || ""}
          loadHits={loadLineHits}
          onScan={canEdit && !sheetLine.is_service ? () => setScanLine(sheetIndex) : undefined}
          onBindApply={bindSheetApply}
          onReportLine={reportSheetLine}
          resolveProduct={async (hit, current, scanCode) => {
            const full = await resolveLineProduct(hit);
            const code = String(scanCode || "").trim();
            const variant = code ? matchProductVariant(full, code) : undefined;
            setProducts((prev) => upsertProducts(prev, [full]));
            return fillInvoiceLineFromProduct(current, full, draft.invoice_type, {
              exportInvoice: draft.trade_kind === "export" || draft.e_type === "e_export",
              variant,
            });
          }}
          onClose={() => setSheetIndex(null)}
          onSave={(next) => {
            const index = sheetIndexRef.current;
            if (index == null) return;
            setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === index ? next : it)) }));
            setSheetIndex(null);
          }}
          onDelete={() => {
            const index = sheetIndexRef.current;
            if (index == null) return;
            setDraft((d) => ({ ...d, items: removeInvoiceItem(d.items, index, defaultVat) }));
            setSheetIndex(null);
          }}
        />
      ) : null}
    </Screen>
  );
}

function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}>
      <Text style={{ flex: 1, fontSize: 11, fontWeight: "800", letterSpacing: 0.4, color: colors.muted }}>{title}</Text>
      {right}
    </View>
  );
}

function LineStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, backgroundColor: colors.slate50, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 6 }}>
      <Text style={{ fontSize: 9, fontWeight: "800", color: colors.muted }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "800", color: colors.text }}>{value}</Text>
    </View>
  );
}
