import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { Chip, confirmAction, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { DateField } from "../components/DateField";
import { Badge, Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { ImageUploader } from "../components/ImageUploader";
import { ProjectStagePhotos, ProjectWorkPreview } from "../components/ProjectStagePhotos";
import { LocationPicker, type LocationValue } from "../components/LocationPicker";
import { ProductPickRow } from "../components/ProductPickRow";
import { ProductThumb } from "../components/ProductThumb";
import { QuoteActions } from "../components/QuoteActions";
import { colors } from "../theme";
import type { Contact, Invoice, Product } from "../types";
import { invoiceListSubtitle } from "../utils/invoiceDraft";
import { VAT_OPTIONS } from "../utils/documentLines";
import { go } from "../nav";
import { coordText, mapsLink } from "../utils/geo";
import { normalizeProjectStages, type ProjectStage } from "../utils/projectStages";
import type { StagePhoto } from "../utils/stagePhotos";
import { statusTr, trUpper } from "../utils/labels";
import { ymdOrToday } from "../utils/calendar";
import { fmtMoney, getPriceDecimals, idOf, todayIso } from "../utils/money";
import { filterProducts } from "../utils/productDisplay";
import {
  emptyProjectExpenseDraft,
  expenseCalc,
  expenseCategoryGroups,
  expensePayload,
  validateExpenseDraft,
  type Expense,
  type ExpenseCategory,
  type ExpenseDraft,
} from "../utils/finance";
import {
  emptyItem,
  hydrateWorkItem,
  namedItems,
  newButtonLabel,
  QUOTE_ITEM_THUMB,
  QUOTE_SERVICE_THUMB,
  PROJECT_MAPS_ACTION,
  PROJECT_NEW_QUOTE_ACTION,
  SURVEY_MAPS_ACTION,
  projectMetricSectionOrder,
  projectQuoteNavParams,
  quoteListSubtitle,
  quoteListTitle,
  quotesForProject,
  workStatusDotColor,
  workStatusSelectGroups,
  workStatusTone,
  removeWorkItem,
  projectPayload,
  quotePayload,
  quoteSaveMessage,
  quoteUpdateBody,
  shouldAttachQuoteDraftInvoice,
  surveyPayload,
  validateProjectName,
  validateQuoteItems,
  toggleWorkItemService,
  bumpWorkItemQty,
  workItemPriceFromGross,
  workItemFromProduct,
  workItemImage,
  workItemLineGross,
  workItemNoteOpen,
  workItemTotals,
  itemStripe,
  type ProjectDoc,
  type QuoteDoc,
  type SurveyDoc,
  type WorkItem,
  type WorkKind,
} from "../utils/workDocs";

const PERM: Record<WorkKind, string> = { quote: "/quotes", project: "/projects", survey: "/surveys" };

function quotePriceText(v: unknown): string {
  const x = Number(v);
  if (!Number.isFinite(x)) return "";
  return x.toFixed(getPriceDecimals());
}

function quoteDraftSig(
  title: string,
  contactId: string,
  contactName: string,
  validUntil: string,
  notes: string,
  status: string,
  items: WorkItem[],
) {
  return JSON.stringify({
    title,
    contactId,
    contactName,
    validUntil,
    notes,
    status,
    items: items.map((it) => ({
      product_id: it.product_id || "",
      name: it.name || "",
      quantity: Number(it.quantity) || 0,
      unit_price: Number(it.unit_price) || 0,
      vat_rate: Number(it.vat_rate) || 0,
      is_service: !!it.is_service,
      description: it.description || "",
    })),
  });
}

export function WorkFormScreen({ kind, docId }: { kind: WorkKind; docId?: string }) {
  const {
    contact_id: preContactId,
    contact_name: preContactName,
    project_id: preProjectId,
    title: preTitle,
    open_expense: openExpense,
    section: focusSection,
  } = useLocalSearchParams<{
    contact_id?: string;
    contact_name?: string;
    project_id?: string;
    title?: string;
    open_expense?: string;
    section?: string;
  }>();
  const { client, companyId, can } = useAuth();
  const canEdit = can(PERM[kind], "edit");
  const canExp = can("/expenses", "edit");
  const canQuote = can("/quotes", "edit");
  const isNew = !docId;
  const [title, setTitle] = useState(isNew ? String(preTitle || "") : "");
  const [linkedProjectId, setLinkedProjectId] = useState(isNew ? String(preProjectId || "") : "");
  const [name, setName] = useState("");
  const [contactId, setContactId] = useState(isNew ? String(preContactId || "") : "");
  const [contactName, setContactName] = useState(isNew ? String(preContactName || "") : "");
  const [custQ, setCustQ] = useState("");
  const [prodQ, setProdQ] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState(kind === "project" ? ymdOrToday() : "");
  const [endDate, setEndDate] = useState("");
  const [surveyDate, setSurveyDate] = useState(todayIso());
  const [location, setLocation] = useState<LocationValue>({ url: "", lat: "", lng: "" });
  const [photos, setPhotos] = useState<string[]>([]);
  const [status, setStatus] = useState(kind === "quote" ? "draft" : kind === "project" ? "planning" : "planned");
  const [items, setItems] = useState<WorkItem[]>([emptyItem()]);
  const [noteOpen, setNoteOpen] = useState<Record<number, boolean>>({});
  const [grossDraft, setGrossDraft] = useState<Record<number, string>>({});
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [quote, setQuote] = useState<QuoteDoc | null>(null);
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [projectStages, setProjectStages] = useState<ProjectStage[]>([]);
  const [workPreview, setWorkPreview] = useState(false);
  const [survey, setSurvey] = useState<SurveyDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectExpenses, setProjectExpenses] = useState<Expense[]>([]);
  const [projectQuotes, setProjectQuotes] = useState<QuoteDoc[]>([]);
  const [projectInvoices, setProjectInvoices] = useState<Invoice[]>([]);
  const [expOpen, setExpOpen] = useState(false);
  const [expDraft, setExpDraft] = useState<ExpenseDraft>(emptyProjectExpenseDraft(todayIso()));
  const [expCats, setExpCats] = useState<ExpenseCategory[]>([]);
  const [expBusy, setExpBusy] = useState(false);
  const quoteBaseline = useRef("");

  const loadRefs = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        get<Contact[]>(client, "/contacts", { company_id: companyId, lite: true }),
        get<Product[]>(client, "/products", { company_id: companyId, lite: true }),
      ]);
      setContacts(c || []);
      setProducts((p || []).filter((x) => x.is_active !== false));
    } catch (err) {
      setError(apiErrorMessage(err, "Cari / stok listesi yüklenemedi."));
    }
  }, [client, companyId]);

  const loadDoc = useCallback(async () => {
    if (!docId) { await loadRefs(); return; }
    try {
      if (kind === "quote") {
        const q = await get<QuoteDoc>(client, `/quotes/${docId}`);
        setQuote(q);
        setTitle(q.title || "");
        setContactId(q.contact_id || "");
        setContactName(q.contact_name || "");
        setValidUntil(String(q.valid_until || "").slice(0, 10));
        setNotes(q.notes || "");
        setStatus(q.status || "draft");
        setLinkedProjectId(q.project_id || "");
        setPhotos(q.images || []);
        const its = (q.items || []).filter((i) => i?.name);
        const nextItems = its.length
          ? its.map((i) => ({ ...emptyItem(), ...i, quantity: Number(i.quantity) || 1, unit_price: Number(i.unit_price) || 0, vat_rate: Number(i.vat_rate) || 20 }))
          : [emptyItem()];
        setItems(nextItems);
        quoteBaseline.current = quoteDraftSig(
          q.title || "",
          q.contact_id || "",
          q.contact_name || "",
          String(q.valid_until || "").slice(0, 10),
          q.notes || "",
          q.status || "draft",
          nextItems,
        );
      } else if (kind === "project") {
        const rows = await get<ProjectDoc[]>(client, "/projects", { company_id: companyId, light: 1 });
        const p = (rows || []).find((x) => idOf(x) === docId) || null;
        if (!p) { setError("Proje bulunamadı."); return; }
        setProject(p);
        setName(p.name || "");
        setContactId(p.contact_id || "");
        setContactName(p.contact_name || "");
        setBudget(String(p.budget ?? ""));
        setStartDate(p.start_date ? ymdOrToday(p.start_date) : ymdOrToday());
        setEndDate(String(p.end_date || "").slice(0, 10));
        setNotes(p.description || "");
        setAddress(p.address || "");
        setLocation({ url: p.location_url || "", lat: coordText(p.latitude), lng: coordText(p.longitude) });
        setPhotos(p.images || []);
        setStatus(p.status || "planning");
        const stages = await get<{ stages?: ProjectStage[] }>(client, `/companies/${companyId}/project-stages`).catch(() => ({ stages: [] }));
        setProjectStages(normalizeProjectStages(stages?.stages));
        const [expList, quoteRows, invoiceRows] = await Promise.all([
          get<{ expenses?: Expense[] }>(client, "/expenses", { company_id: companyId, project_id: docId }).catch(() => ({ expenses: [] })),
          get<QuoteDoc[]>(client, "/quotes", { company_id: companyId, summary: 1 }).catch(() => []),
          get<Invoice[]>(client, "/invoices", { company_id: companyId, project_id: docId }).catch(() => []),
        ]);
        setProjectExpenses(expList.expenses || []);
        setProjectQuotes(quotesForProject(quoteRows, p));
        setProjectInvoices(invoiceRows || []);
      } else {
        const rows = await get<SurveyDoc[]>(client, "/surveys", { company_id: companyId });
        const s = (rows || []).find((x) => idOf(x) === docId) || null;
        if (!s) { setError("Keşif bulunamadı."); return; }
        setSurvey(s);
        setContactId(s.contact_id || "");
        setContactName(s.contact_name || "");
        setAddress(s.address || "");
        setSurveyDate(String(s.survey_date || todayIso()).slice(0, 10));
        setNotes(s.notes || "");
        setLocation({ url: s.location_url || "", lat: coordText(s.latitude), lng: coordText(s.longitude) });
        setPhotos(s.images || []);
        setStatus(s.status || "planned");
        const ms = s.measurements || [];
        setItems(ms.length ? ms.map((i) => ({ ...emptyItem(), ...i, quantity: Number(i.quantity) || 1, unit_price: Number(i.unit_price) || 0 })) : [emptyItem()]);
      }
      setError(null);
      await loadRefs();
    } catch (err) {
      setError(apiErrorMessage(err, "Kayıt yüklenemedi."));
    }
  }, [client, companyId, docId, kind, loadRefs]);

  useFocusEffect(useCallback(() => { loadDoc(); }, [loadDoc]));

  const form = {
    contact_id: contactId,
    contact_name: contactName,
    title,
    project_id: linkedProjectId,
    valid_until: validUntil,
    notes,
    name,
    budget,
    start_date: startDate,
    end_date: endDate,
    address,
    survey_date: surveyDate,
    location_url: location.url,
    latitude: location.lat,
    longitude: location.lng,
  };
  const pricedItems = items.map((it) => hydrateWorkItem(it, products.find((p) => idOf(p) === it.product_id)));
  const totals = workItemTotals(pricedItems);
  const custHits = custQ.trim().length < 2 ? [] : contacts.filter((c) => [c.name, c.phone].some((v) => String(v || "").toLowerCase().includes(custQ.trim().toLowerCase()))).slice(0, 8);
  const prodHits = prodQ.trim().length < 2 ? [] : filterProducts(products, prodQ, "all", 8);
  const statusGroups = workStatusSelectGroups(kind, status, projectStages);

  const patchItem = (i: number, field: keyof WorkItem, value: string | number | boolean) => {
    setItems((rows) => rows.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  };

  const toggleLineKind = (i: number) => {
    if (!canEdit) return;
    setItems((rows) => rows.map((it, idx) => (idx === i ? toggleWorkItemService(it) : it)));
  };

  const removeItem = (i: number) => {
    if (!canEdit) return;
    setItems((rows) => removeWorkItem(rows, i));
  };

  const addProductFromSearch = (p: Product) => {
    setItems((rows) => {
      const emptyIdx = rows.findIndex((it) => !it.name);
      const line = workItemFromProduct(p);
      if (emptyIdx >= 0) return rows.map((it, i) => (i === emptyIdx ? line : it));
      return [...rows, line];
    });
    setProdQ("");
  };

  const persistArgs = useRef({ form, pricedItems, status, quote, items, title, contactId, contactName, validUntil, notes });
  persistArgs.current = { form, pricedItems, status, quote, items, title, contactId, contactName, validUntil, notes };

  const persistExistingQuote = useCallback(async (quiet = false) => {
    if (!docId || !canEdit) return false;
    const a = persistArgs.current;
    const invalid = validateQuoteItems(a.items);
    if (invalid) {
      setError(invalid);
      return false;
    }
    await put(client, `/quotes/${docId}`, quoteUpdateBody(a.form, a.pricedItems));
    if (a.status !== (a.quote?.status || "draft")) await put(client, `/quotes/${docId}`, { status: a.status });
    quoteBaseline.current = quoteDraftSig(a.title, a.contactId, a.contactName, a.validUntil, a.notes, a.status, a.items);
    if (!quiet) {
      setMessage("Teklif güncellendi.");
      await loadDoc();
    }
    return true;
  }, [canEdit, client, docId, loadDoc]);

  useEffect(() => {
    if (kind !== "quote" || isNew || !canEdit || !docId || !quote) return;
    const sig = quoteDraftSig(title, contactId, contactName, validUntil, notes, status, items);
    if (!quoteBaseline.current || sig === quoteBaseline.current) return;
    const t = setTimeout(() => {
      void persistExistingQuote(true).catch((err) => setError(apiErrorMessage(err, "Kaydedilemedi.")));
    }, 700);
    return () => clearTimeout(t);
  }, [kind, isNew, canEdit, docId, quote, title, contactId, contactName, validUntil, notes, status, items, persistExistingQuote]);

  const save = async () => {
    if (!canEdit) { setError("Düzenleme yetkiniz yok."); return; }
    if (kind === "quote") {
      const invalid = validateQuoteItems(items);
      if (invalid) { setError(invalid); return; }
    }
    if (kind === "project") {
      const invalid = validateProjectName(name);
      if (invalid) { setError(invalid); return; }
    }
    setBusy(true);
    try {
      if (kind === "quote") {
        let qid = docId;
        let currentQuote = quote;
        if (isNew) {
          const created = await post<QuoteDoc>(client, "/quotes", quotePayload(companyId, form, pricedItems));
          qid = idOf(created);
          currentQuote = created;
        } else if (!(await persistExistingQuote(true))) {
          return;
        }
        let invoiceNumber = "";
        if (qid && shouldAttachQuoteDraftInvoice(currentQuote, contactId)) {
          try {
            const r = await post<{ invoice?: { invoice_number?: string }; message?: string }>(
              client,
              `/quotes/${qid}/convert-to-invoice`,
            );
            invoiceNumber = r.invoice?.invoice_number || "";
          } catch (err) {
            setError(apiErrorMessage(err, "Taslak fatura oluşturulamadı."));
            if (isNew && qid) router.replace({ pathname: "/quotes/[id]", params: { id: qid } });
            else await loadDoc();
            return;
          }
        }
        setMessage(quoteSaveMessage({
          createdInvoiceNumber: invoiceNumber,
          hasContact: Boolean(contactId),
          alreadyInvoiced: Boolean(currentQuote?.invoice_id),
        }));
        if (isNew && qid) {
          router.replace({ pathname: "/quotes/[id]", params: { id: qid } });
        } else {
          await loadDoc();
        }
      } else if (kind === "project") {
        if (isNew) {
          const created = await post<ProjectDoc>(client, "/projects", projectPayload(companyId, form));
          router.replace({ pathname: "/projects/[id]", params: { id: idOf(created) } });
        } else {
          await put(client, `/projects/${docId}`, { ...projectPayload(companyId, form), status });
          setMessage("Proje güncellendi.");
          await loadDoc();
        }
      } else if (isNew) {
        const created = await post<SurveyDoc>(client, "/surveys", surveyPayload(companyId, form, items));
        router.replace({ pathname: "/surveys/[id]", params: { id: idOf(created) } });
      } else {
        await put(client, `/surveys/${docId}`, { ...surveyPayload(companyId, form, items), status });
        setMessage("Keşif güncellendi.");
        await loadDoc();
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const openProjectExpense = () => {
    setExpDraft(emptyProjectExpenseDraft(todayIso()));
    setExpOpen(true);
    get<ExpenseCategory[]>(client, "/expenses/categories", { company_id: companyId })
      .then((cats) => setExpCats(Array.isArray(cats) ? cats : []))
      .catch(() => undefined);
  };

  const openedExpense = useRef(false);
  useEffect(() => {
    if (kind !== "project" || isNew || !canExp || openedExpense.current) return;
    if (String(openExpense || "") !== "1") return;
    openedExpense.current = true;
    openProjectExpense();
  }, [kind, isNew, canExp, openExpense]);

  const saveProjectExpense = async () => {
    if (!docId || kind !== "project") return;
    const invalid = validateExpenseDraft(expDraft);
    if (invalid) { setError(invalid); return; }
    setExpBusy(true);
    try {
      await post(client, "/expenses", expensePayload(expDraft, companyId, docId));
      setExpOpen(false);
      setMessage("Masraf projeye kaydedildi.");
      setError(null);
      await loadDoc();
    } catch (err) {
      setError(apiErrorMessage(err, "Masraf kaydedilemedi."));
    } finally {
      setExpBusy(false);
    }
  };

  const convert = async () => {
    if (!docId || !canEdit) return;
    setBusy(true);
    try {
      if (kind === "survey") {
        const r = await post<{ quote?: QuoteDoc; message?: string }>(client, `/surveys/${docId}/convert-to-quote`);
        setMessage(r.message || "Teklif oluşturuldu.");
        const qid = idOf(r.quote);
        if (qid) router.replace({ pathname: "/quotes/[id]", params: { id: qid } });
      } else if (kind === "quote") {
        if (!(await persistExistingQuote(true))) return;
        const r = await post<{ project?: ProjectDoc; message?: string }>(client, `/quotes/${docId}/convert-to-project`);
        setMessage(r.message || "Proje oluşturuldu.");
        const pid = idOf(r.project);
        if (pid) router.replace({ pathname: "/projects/[id]", params: { id: pid } });
      } else {
        const r = await post<{ invoice?: { id?: string; _id?: string; invoice_number?: string }; message?: string }>(client, `/projects/${docId}/invoice`);
        setMessage(r.message || "Fatura oluşturuldu.");
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Dönüştürülemedi."));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!docId) return;
    const coll = kind === "quote" ? "quotes" : kind === "project" ? "projects" : "surveys";
    confirmAction("Sil", "Kayıt çöp kutusuna taşınsın mı?", () => {
      del(client, `/${coll}/${docId}`)
        .then(() => router.back())
        .catch((err) => setError(apiErrorMessage(err, "Silinemedi.")));
    });
  };

  const heading = isNew
    ? newButtonLabel(kind)
    : kind === "quote"
      ? quote?.quote_number || "Teklif"
      : kind === "project"
        ? project?.project_number || name || "Proje"
        : survey?.survey_number || "Keşif";

  const focus = String(focusSection || "").trim();
  const projectDocs = !isNew && kind === "project" && project
    ? projectMetricSectionOrder(focus).map((key) => {
      const active = focus === key;
      const frame = active ? { borderColor: colors.primary, borderWidth: 2 } : undefined;
      if (key === "quotes") {
        return (
          <Card key="quotes" testID="project-quotes" style={frame}>
            <Text style={{ fontWeight: "800", color: colors.text }}>Teklifler</Text>
            {!projectQuotes.length ? <Muted>Bu projeye teklif yok.</Muted> : projectQuotes.map((q) => (
              <ListRow
                key={idOf(q)}
                testID={`project-quote-${idOf(q)}`}
                title={quoteListSubtitle(q)}
                subtitle={quoteListTitle(q)}
                right={fmtMoney(q.grand_total)}
                onPress={() => go("QuoteDetail", { id: idOf(q) })}
              />
            ))}
          </Card>
        );
      }
      if (key === "invoices") {
        return (
          <Card key="invoices" testID="project-invoices" style={frame}>
            <Text style={{ fontWeight: "800", color: colors.text }}>Faturalar</Text>
            {!projectInvoices.length ? <Muted>Bu projeye fatura yok.</Muted> : projectInvoices.map((inv) => (
              <ListRow
                key={idOf(inv)}
                testID={`project-invoice-${idOf(inv)}`}
                title={inv.invoice_number || "Fatura"}
                subtitle={invoiceListSubtitle(inv)}
                right={fmtMoney(inv.grand_total)}
                onPress={() => go("InvoiceDetail", { id: idOf(inv) })}
              />
            ))}
          </Card>
        );
      }
      return (
        <Card key="expenses" testID="project-expenses" style={frame}>
          <Text style={{ fontWeight: "800", color: colors.text }}>Masraflar</Text>
          {!projectExpenses.length ? <Muted>Bu projeye masraf yok.</Muted> : projectExpenses.map((e) => (
            <ListRow
              key={idOf(e)}
              testID={`project-expense-${idOf(e)}`}
              title={e.description || e.expense_number || "Masraf"}
              subtitle={`${e.expense_number || ""} · ${e.category || ""} · ${statusTr(e.payment_status)} · ${fmtMoney(e.total ?? e.amount)}`}
              onPress={() => router.push({ pathname: "/expenses/[id]", params: { id: idOf(e) } })}
            />
          ))}
        </Card>
      );
    })
    : null;

  return (
    <Screen>
      <H1>{heading}</H1>
      <Muted>{kind === "quote" ? "Cari ve kalemlerle fiyat teklifi." : kind === "project" ? "İş / saha projesi, bütçe ve cari." : "Keşif, ölçü ve teklife dönüştürme."}</Muted>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      {!isNew && kind === "project" && (canExp || canEdit) ? (
        <PrimaryButton title="Masraf ekle" color={colors.danger} testID="project-expense-btn" onPress={openProjectExpense} />
      ) : null}
      {!isNew && kind === "project" && canQuote && project ? (
        <PrimaryButton
          title={PROJECT_NEW_QUOTE_ACTION}
          color={colors.indigo}
          testID="project-new-quote-btn"
          onPress={() => go("QuoteNew", projectQuoteNavParams(project))}
        />
      ) : null}
      {!isNew && kind === "project" && project ? (
        <PrimaryButton
          title={PROJECT_MAPS_ACTION}
          color="#9F1239"
          testID="project-maps-btn"
          onPress={() => {
            const href = mapsLink(project);
            if (!href) {
              Alert.alert("Konum yok", "Bu projeye konum veya adres eklenmemiş.");
              return;
            }
            Linking.openURL(href).catch(() => Alert.alert("Harita açılamadı", "Konum linki açılamadı."));
          }}
        />
      ) : null}
      {!isNew && kind === "survey" && survey ? (
        <PrimaryButton
          title={SURVEY_MAPS_ACTION}
          color="#9F1239"
          testID="survey-maps-btn"
          onPress={() => {
            const href = mapsLink(survey);
            if (!href) {
              Alert.alert("Konum yok", "Bu keşfe konum veya adres eklenmemiş.");
              return;
            }
            Linking.openURL(href).catch(() => Alert.alert("Harita açılamadı", "Konum linki açılamadı."));
          }}
        />
      ) : null}
      {projectDocs}

      {isNew && kind === "quote" && linkedProjectId ? (
        <Muted testID="quote-linked-project">Bu teklif projeye bağlanacak{preTitle ? `: ${preTitle}` : ""}.</Muted>
      ) : null}
      {kind === "quote" ? <Field label="Başlık" testID="q-title" value={title} onChangeText={setTitle} editable={canEdit} /> : null}
      {kind === "project" ? <Field label="Proje adı" testID="p-name" value={name} onChangeText={setName} editable={canEdit} /> : null}

      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          backgroundColor: "#fff",
          paddingHorizontal: 10,
          paddingVertical: 6,
          gap: 4,
        }}
      >
        <Pressable onPress={() => router.push("/contacts/new")} testID="q-new-contact" style={{ minHeight: 22, justifyContent: "center" }}>
          <Text style={{ color: colors.indigo, fontWeight: "800", fontSize: 13 }}>Yeni Cari Aç</Text>
        </Pressable>
        {contactId ? (
          <Pressable
            onPress={() => { setContactId(""); setContactName(""); }}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 30 }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontWeight: "700", color: colors.text, fontSize: 14 }} numberOfLines={1}>{contactName || "Cari"}</Text>
              <Muted>Değiştirmek için dokunun</Muted>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ) : (
          <>
            <Field dense label="Cari ara" value={custQ} onChangeText={setCustQ} placeholder="Ad / telefon" />
            {custHits.map((c) => (
              <ListRow key={idOf(c)} title={c.name} subtitle={c.phone || c.city} onPress={() => { setContactId(idOf(c)); setContactName(c.name); setAddress((a) => a || c.address || ""); setCustQ(""); }} />
            ))}
          </>
        )}
      </View>

      {kind === "quote" ? <DateField label="Geçerlilik" testID="q-valid" value={validUntil} onChangeText={setValidUntil} editable={canEdit} /> : null}
      {kind === "project" ? (
        <>
          <Field label="Bütçe" testID="p-budget" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" editable={canEdit} />
          <DateField label="Başlangıç" testID="p-start" value={startDate} onChangeText={setStartDate} editable={canEdit} defaultToday />
          <DateField label="Bitiş" testID="p-end" value={endDate} onChangeText={setEndDate} min={startDate} editable={canEdit} />
        </>
      ) : null}
      {kind === "survey" ? <DateField label="Keşif tarihi" testID="s-date" value={surveyDate} onChangeText={setSurveyDate} editable={canEdit} /> : null}

      {!isNew ? (
        <View>
          <Row style={{ gap: 8, marginBottom: 4, alignItems: "center" }}>
            <Muted>Durum</Muted>
            <View
              testID={`${kind}-status-dot`}
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: workStatusDotColor(kind, status),
              }}
            />
            <Badge label={statusTr(status)} tone={workStatusTone(kind, status)} />
          </Row>
          <GroupedSelect
            dense
            testID={`${kind}-status`}
            value={status}
            onChange={(v) => canEdit && setStatus(v)}
            groups={statusGroups}
            emptyLabel="Durum seçin"
            swatchColor={workStatusDotColor(kind, status)}
          />
        </View>
      ) : null}

      {kind !== "project" ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text, fontSize: 13 }}>Kalemler</Text>
          <View
            testID="q-stock-search"
            style={{
              backgroundColor: colors.slate50,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 8,
              gap: 6,
            }}
          >
            <Field dense label="Ürün ara" testID="q-prod-search" value={prodQ} onChangeText={setProdQ} placeholder="Ad / SKU" />
            {prodHits.length ? (
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 168 }}>
                {prodHits.map((p) => (
                  <ProductPickRow
                    key={idOf(p)}
                    product={p}
                    testID={`q-prod-${idOf(p)}`}
                    onPress={() => addProductFromSearch(p)}
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>
          {items.map((it, i) => {
            const prod = products.find((p) => idOf(p) === it.product_id);
            const noteShown = kind === "quote" && workItemNoteOpen(it, noteOpen[i]);
            const quoteGrossField = (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 999,
                  backgroundColor: "#fff",
                  minHeight: 32,
                  paddingHorizontal: 10,
                  gap: 4,
                  overflow: "hidden",
                }}
              >
                <TextInput
                  testID={`q-item-gross-${i}`}
                  value={grossDraft[i] ?? (it.name ? quotePriceText(workItemLineGross(it)) : "")}
                  onFocus={() => setGrossDraft((m) => ({ ...m, [i]: quotePriceText(workItemLineGross(it)) }))}
                  onBlur={() => setGrossDraft((m) => {
                    const next = { ...m };
                    delete next[i];
                    return next;
                  })}
                  onChangeText={(v) => {
                    if (!canEdit) return;
                    setGrossDraft((m) => ({ ...m, [i]: v }));
                    const unit = workItemPriceFromGross(it, n(v));
                    setItems((rows) => rows.map((row, idx) => (
                      idx === i ? { ...row, unit_price: unit, unit_price_incl: undefined } : row
                    )));
                  }}
                  keyboardType="decimal-pad"
                  editable={canEdit}
                  numberOfLines={1}
                  style={{ flex: 1, minWidth: 0, textAlign: "right", fontWeight: "800", fontSize: 15, color: colors.text, padding: 0, minHeight: 32 }}
                />
                <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 13, flexShrink: 0 }}>₺</Text>
              </View>
            );
            return (
            <View
              key={i}
              testID={`q-item-row-${i}`}
              style={{
                ...itemStripe(i),
                borderRadius: 12,
                padding: 6,
                gap: 6,
              }}
            >
              <View style={{ gap: 4 }}>
                  {kind === "quote" ? (
                    <Row style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <Row style={{ flexWrap: "wrap", gap: 4, flex: 1, alignItems: "center" }}>
                        <Chip
                          compact
                          label="Ürün"
                          active={!it.is_service}
                          color={colors.primary}
                          testID={`q-item-kind-product-${i}`}
                          onPress={() => it.is_service && toggleLineKind(i)}
                        />
                        <Chip
                          compact
                          label="Hizmet"
                          active={!!it.is_service}
                          color={colors.indigo}
                          testID={`q-item-kind-service-${i}`}
                          onPress={() => !it.is_service && toggleLineKind(i)}
                        />
                      </Row>
                      {canEdit ? (
                        <Pressable
                          onPress={() => removeItem(i)}
                          testID={`q-item-del-${i}`}
                          accessibilityLabel="Kalemi sil"
                          style={{ width: 24, height: 28, alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                        >
                          <Ionicons name="trash-outline" size={18} color={colors.danger} />
                        </Pressable>
                      ) : null}
                    </Row>
                  ) : (
                    <Field
                      dense
                      label={it.is_service ? "Hizmet adı" : "Ürün"}
                      testID={`q-item-name-${i}`}
                      value={it.name}
                      onChangeText={(v) => patchItem(i, "name", v)}
                      editable={canEdit}
                      placeholder={it.is_service ? "Hizmet adı yazın" : "Ürün adı"}
                    />
                  )}
                  {kind === "quote" ? (
                    <Row style={{ alignItems: "stretch", gap: 8 }}>
                      <View style={{ justifyContent: "center" }}>
                        <ProductThumb
                          uri={workItemImage(it, prod)}
                          width={QUOTE_SERVICE_THUMB.width}
                          height={QUOTE_SERVICE_THUMB.height}
                          testID={`q-item-thumb-${i}`}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                        <View>
                          <Text style={{ fontSize: 9, fontWeight: "700", color: colors.muted, marginBottom: 1 }}>
                            {trUpper(it.is_service ? "Hizmet adı" : "Ürün")}
                          </Text>
                          <View
                            style={{
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: 12,
                              backgroundColor: "#fff",
                              minHeight: 32,
                              paddingHorizontal: 8,
                              justifyContent: "center",
                            }}
                          >
                            <TextInput
                              testID={`q-item-name-${i}`}
                              value={it.name}
                              onChangeText={(v) => patchItem(i, "name", v)}
                              editable={canEdit}
                              placeholder={it.is_service ? "Hizmet adı yazın" : "Ürün adı"}
                              placeholderTextColor={colors.muted}
                              style={{ fontWeight: "700", fontSize: 13, color: colors.text, padding: 0, minHeight: 32 }}
                            />
                          </View>
                        </View>
                        <Row style={{ alignItems: "flex-end", gap: 6 }}>
                          <View style={{ flexShrink: 0 }}>
                            <Text style={{ fontSize: 9, fontWeight: "700", color: colors.muted, marginBottom: 1 }}>{trUpper("Miktar")}</Text>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: 999,
                                backgroundColor: "#fff",
                                overflow: "hidden",
                                minHeight: 32,
                              }}
                            >
                              <Pressable
                                testID={`q-item-qty-dec-${i}`}
                                accessibilityLabel="Miktarı azalt"
                                disabled={!canEdit}
                                onPress={() => patchItem(i, "quantity", bumpWorkItemQty(it.quantity, -1))}
                                style={{ width: 28, height: 32, alignItems: "center", justifyContent: "center" }}
                              >
                                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>−</Text>
                              </Pressable>
                              <TextInput
                                testID={`q-item-qty-${i}`}
                                value={String(it.quantity)}
                                onChangeText={(v) => patchItem(i, "quantity", n(v))}
                                keyboardType="decimal-pad"
                                editable={canEdit}
                                style={{ width: 32, textAlign: "center", fontWeight: "700", fontSize: 13, color: colors.text, padding: 0, minHeight: 32 }}
                              />
                              <Pressable
                                testID={`q-item-qty-inc-${i}`}
                                accessibilityLabel="Miktarı artır"
                                disabled={!canEdit}
                                onPress={() => patchItem(i, "quantity", bumpWorkItemQty(it.quantity, 1))}
                                style={{ width: 28, height: 32, alignItems: "center", justifyContent: "center" }}
                              >
                                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>+</Text>
                              </Pressable>
                            </View>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontSize: 9, fontWeight: "700", color: colors.muted, marginBottom: 1 }}>{trUpper("Fiyat")}</Text>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                borderWidth: 1,
                                borderColor: colors.border,
                                borderRadius: 999,
                                backgroundColor: "#fff",
                                minHeight: 32,
                                paddingHorizontal: 8,
                                gap: 4,
                                overflow: "hidden",
                                minWidth: 0,
                              }}
                            >
                              <TextInput
                                testID={`q-item-price-${i}`}
                                value={quotePriceText(it.unit_price)}
                                onChangeText={(v) => patchItem(i, "unit_price", n(v))}
                                keyboardType="decimal-pad"
                                editable={canEdit}
                                numberOfLines={1}
                                style={{ flex: 1, minWidth: 0, fontWeight: "700", fontSize: 12, color: colors.text, padding: 0, minHeight: 32 }}
                              />
                              <Text style={{ color: colors.muted, fontWeight: "700", fontSize: 12, flexShrink: 0 }}>₺</Text>
                            </View>
                          </View>
                        </Row>
                        {quoteGrossField}
                      </View>
                    </Row>
                  ) : (
                    <Row style={{ alignItems: "flex-start", gap: 8 }}>
                      <ProductThumb
                        uri={workItemImage(it, prod)}
                        width={QUOTE_ITEM_THUMB.width}
                        height={QUOTE_ITEM_THUMB.height}
                        testID={`q-item-thumb-${i}`}
                      />
                      <Row style={{ flex: 1, alignItems: "flex-end", gap: 6 }}>
                        <View style={{ width: 52, flexShrink: 0 }}>
                          <Field dense label="Miktar" testID={`q-item-qty-${i}`} value={String(it.quantity)} onChangeText={(v) => patchItem(i, "quantity", n(v))} keyboardType="decimal-pad" editable={canEdit} />
                        </View>
                        <View style={{ width: 70, flexShrink: 0 }}>
                          <Field dense label="Fiyat" testID={`q-item-price-${i}`} value={String(it.unit_price)} onChangeText={(v) => patchItem(i, "unit_price", n(v))} keyboardType="decimal-pad" editable={canEdit} />
                        </View>
                        <Text style={{ flex: 1, minWidth: 56, textAlign: "right", fontWeight: "800", color: colors.text, fontSize: 13, marginBottom: 4 }} testID={`q-item-gross-${i}`}>
                          {it.name ? fmtMoney(workItemLineGross(it)) : ""}
                        </Text>
                        {canEdit ? (
                          <Pressable
                            onPress={() => removeItem(i)}
                            testID={`q-item-del-${i}`}
                            accessibilityLabel="Kalemi sil"
                            style={{ width: 28, height: 30, alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                          >
                            <Ionicons name="trash-outline" size={20} color={colors.danger} />
                          </Pressable>
                        ) : null}
                      </Row>
                    </Row>
                  )}
                  {kind === "quote" ? (
                    <>
                      <Row style={{ alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Pressable
                          onPress={() => setNoteOpen((m) => ({ ...m, [i]: !noteShown }))}
                          testID={`q-item-note-toggle-${i}`}
                          accessibilityLabel={noteShown ? "Açıklamayı gizle" : "Açıklama ekle"}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            minHeight: 32,
                            paddingHorizontal: 10,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: noteShown ? colors.indigo : colors.border,
                            backgroundColor: noteShown ? colors.indigo50 : "#fff",
                          }}
                        >
                          <Ionicons name={noteShown ? "chevron-up" : "add"} size={16} color={colors.indigo} />
                          <Text style={{ fontWeight: "700", fontSize: 12, color: colors.indigo }}>
                            {noteShown ? "Açıklamayı gizle" : (it.description || "").trim() ? "Açıklama" : "Açıklama ekle"}
                          </Text>
                        </Pressable>
                        <Row style={{ flex: 1, flexWrap: "wrap", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
                          {VAT_OPTIONS.map((v) => (
                            <Chip
                              compact
                              key={v}
                              label={`%${v}`}
                              active={Number(it.vat_rate) === v}
                              onPress={() => canEdit && patchItem(i, "vat_rate", v)}
                              testID={`q-item-vat-${i}-${v}`}
                            />
                          ))}
                        </Row>
                      </Row>
                      {noteShown ? (
                        <Field
                          dense
                          multiline
                          numberOfLines={3}
                          label="Açıklama"
                          testID={`q-item-note-${i}`}
                          value={it.description || ""}
                          onChangeText={(v) => patchItem(i, "description", v)}
                          editable={canEdit}
                          placeholder="Satır notu, ölçü, kesim…"
                        />
                      ) : null}
                    </>
                  ) : null}
              </View>
            </View>
            );
          })}
          {canEdit ? (
            <PrimaryButton
              title="Satır ekle"
              color={colors.indigo}
              testID="q-add-item-btn"
              onPress={() => setItems((rows) => [...rows, emptyItem()])}
            />
          ) : null}
          {namedItems(items).length ? (
            <Row style={{ justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "800" }}>Toplam (KDV Dahil)</Text>
              <Text style={{ fontWeight: "800", color: colors.primary }}>{fmtMoney(totals.grandTotal)}</Text>
            </Row>
          ) : null}
        </Card>
      ) : null}

      {kind !== "quote" ? <Field dense label="Adres" value={address} onChangeText={setAddress} editable={canEdit} /> : null}
      {kind !== "quote" ? (
        <LocationPicker label="Konum" value={location} onChange={setLocation} editable={canEdit} testID="work-location" />
      ) : null}
      {kind === "project" && project ? (
        <ProjectStagePhotos
          project={project}
          stages={projectStages}
          editable={canEdit}
          onChanged={(patch: { stage_photos: StagePhoto[]; images: string[] }) => {
            setProject((cur) => (cur ? { ...cur, ...patch } : cur));
            setPhotos(patch.images);
          }}
          onPreview={() => setWorkPreview(true)}
          testID="project-stage-photos"
        />
      ) : (
        <ImageUploader
          entity={kind}
          entityId={docId}
          images={photos}
          onUploaded={(url) => setPhotos((prev) => [...prev, url])}
          editable={canEdit}
          testID="work-photos"
        />
      )}

      <Field dense label="Not" value={notes} onChangeText={setNotes} editable={canEdit} />
      {isNew || kind !== "quote" ? (
        <PrimaryButton title={busy ? "Kaydediliyor…" : "Kaydet"} onPress={save} loading={busy} disabled={!canEdit} color={colors.primary} testID={`${kind}-save`} />
      ) : null}

      {!isNew && kind === "survey" && !survey?.quote_id && canEdit ? (
        <PrimaryButton title="Teklife dönüştür" onPress={() => confirmAction("Teklif", "Keşif teklife dönüştürülsün mü?", convert)} color={colors.indigo} testID="survey-to-quote" />
      ) : null}
      {!isNew && kind === "quote" && !quote?.project_id && canEdit ? (
        <PrimaryButton title="Projeye dönüştür" onPress={() => confirmAction("Proje", "Teklif projeye dönüştürülsün mü?", convert)} color={colors.indigo} testID="quote-to-project" />
      ) : null}
      {!isNew && kind === "project" && project?.can_invoice && canEdit ? (
        <PrimaryButton title="Projeyi faturalandır" onPress={convert} color={colors.primary} testID="project-invoice" />
      ) : null}
      {kind === "project" && project ? (
        <Muted>Teklif {fmtMoney(project.quoted_total)} · Fatura {fmtMoney(project.invoiced_total)} · Masraf {fmtMoney(project.expense_total)}</Muted>
      ) : null}
      {!isNew && kind === "quote" && quote ? (
        <QuoteActions
          quote={{ ...quote, title, contact_name: contactName, valid_until: validUntil, notes, items, grand_total: totals.grandTotal }}
          contact={contacts.find((c) => idOf(c) === contactId) || null}
          onSave={canEdit ? save : undefined}
          saveBusy={busy}
          onReloaded={loadDoc}
          onMessage={setMessage}
          onError={setError}
        />
      ) : null}
      {!isNew && canEdit ? (
        <Pressable onPress={remove} testID={`${kind}-delete`} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14 }}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: "800" }}>Sil</Text>
        </Pressable>
      ) : null}

      <B2BSheet
        visible={expOpen}
        title="Masraf ekle"
        subtitle={project ? `${project.name || name} · ${project.project_number || ""}` : undefined}
        onClose={() => setExpOpen(false)}
        testID="project-expense-modal"
      >
        <Field label="Tarih" testID="proj-exp-date" value={expDraft.date} onChangeText={(v) => setExpDraft((d) => ({ ...d, date: v }))} placeholder="YYYY-MM-DD" />
        <GroupedSelect
          label="Kategori"
          testID="proj-exp-category"
          value={expDraft.category}
          onChange={(v) => setExpDraft((d) => ({ ...d, category: v }))}
          groups={expenseCategoryGroups(expCats, [expDraft.category])}
        />
        <Field label="Açıklama" testID="proj-exp-description" value={expDraft.description} onChangeText={(v) => setExpDraft((d) => ({ ...d, description: v }))} placeholder="Örn: Şantiye malzemesi" />
        <Field label="Tutar (₺)" testID="proj-exp-amount" value={expDraft.amount} onChangeText={(v) => setExpDraft((d) => ({ ...d, amount: v }))} keyboardType="decimal-pad" />
        <Muted>KDV %</Muted>
        <Row>
          {[0, 1, 10, 20].map((v) => (
            <Chip key={v} label={`%${v}`} active={n(expDraft.vat_rate) === v} onPress={() => setExpDraft((d) => ({ ...d, vat_rate: String(v) }))} />
          ))}
        </Row>
        <Chip
          label="Tutar KDV dahil"
          active={expDraft.vat_included}
          onPress={() => setExpDraft((d) => ({ ...d, vat_included: !d.vat_included }))}
          testID="proj-exp-vat-included"
        />
        <Card>
          <Row style={{ justifyContent: "space-between" }}><Muted>Toplam</Muted><Text style={{ fontWeight: "800", color: colors.danger }}>{fmtMoney(expenseCalc(expDraft).total)}</Text></Row>
        </Card>
        <Field label="Not" testID="proj-exp-notes" value={expDraft.notes} onChangeText={(v) => setExpDraft((d) => ({ ...d, notes: v }))} />
        <PrimaryButton
          title={expBusy ? "Kaydediliyor…" : "Masrafı kaydet"}
          color={colors.danger}
          loading={expBusy}
          onPress={saveProjectExpense}
          testID="proj-exp-save"
        />
      </B2BSheet>
      <B2BSheet
        visible={workPreview && !!project}
        title="Yapılan işler"
        subtitle={project ? `${project.contact_name || "Müşteri"} · takip linkinde böyle görünür` : undefined}
        onClose={() => setWorkPreview(false)}
        testID="project-work-preview-sheet"
      >
        {project ? <ProjectWorkPreview project={project} stages={projectStages} /> : null}
      </B2BSheet>
    </Screen>
  );
}
