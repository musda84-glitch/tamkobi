import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import * as Location from "expo-location";
import React, { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { del, get, post, put } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { Chip, confirmAction, n } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Card, ErrorBanner, Field, H1, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { ImageUploader } from "../components/ImageUploader";
import { LocationPicker, type LocationValue } from "../components/LocationPicker";
import { ProductPickRow } from "../components/ProductPickRow";
import { QuoteActions } from "../components/QuoteActions";
import { colors } from "../theme";
import type { Contact, Product } from "../types";
import { coordText } from "../utils/geo";
import { statusTr } from "../utils/labels";
import { fmtMoney, idOf, todayIso } from "../utils/money";
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
  PROJECT_STATUSES,
  QUOTE_STATUSES,
  SURVEY_STATUSES,
  emptyItem,
  hydrateWorkItem,
  namedItems,
  newButtonLabel,
  removeWorkItem,
  projectPayload,
  quotePayload,
  quoteUpdateBody,
  surveyPayload,
  validateProjectName,
  validateQuoteItems,
  workItemFromProduct,
  workItemTotals,
  itemStripe,
  type ProjectDoc,
  type QuoteDoc,
  type SurveyDoc,
  type WorkItem,
  type WorkKind,
} from "../utils/workDocs";

const PERM: Record<WorkKind, string> = { quote: "/quotes", project: "/projects", survey: "/surveys" };

export function WorkFormScreen({ kind, docId }: { kind: WorkKind; docId?: string }) {
  const { contact_id: preContactId, contact_name: preContactName } = useLocalSearchParams<{
    contact_id?: string;
    contact_name?: string;
  }>();
  const { client, companyId, can } = useAuth();
  const canEdit = can(PERM[kind], "edit");
  const canExp = can("/expenses", "edit");
  const isNew = !docId;
  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [contactId, setContactId] = useState(isNew ? String(preContactId || "") : "");
  const [contactName, setContactName] = useState(isNew ? String(preContactName || "") : "");
  const [custQ, setCustQ] = useState("");
  const [prodQ, setProdQ] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [surveyDate, setSurveyDate] = useState(todayIso());
  const [location, setLocation] = useState<LocationValue>({ url: "", lat: "", lng: "" });
  const [photos, setPhotos] = useState<string[]>([]);
  const [status, setStatus] = useState(kind === "quote" ? "draft" : kind === "project" ? "planning" : "planned");
  const [items, setItems] = useState<WorkItem[]>([emptyItem()]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [quote, setQuote] = useState<QuoteDoc | null>(null);
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [survey, setSurvey] = useState<SurveyDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [projectExpenses, setProjectExpenses] = useState<Expense[]>([]);
  const [expOpen, setExpOpen] = useState(false);
  const [expDraft, setExpDraft] = useState<ExpenseDraft>(emptyProjectExpenseDraft(todayIso()));
  const [expCats, setExpCats] = useState<ExpenseCategory[]>([]);
  const [expBusy, setExpBusy] = useState(false);

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
        const its = (q.items || []).filter((i) => i?.name);
        setItems(its.length ? its.map((i) => ({ ...emptyItem(), ...i, quantity: Number(i.quantity) || 1, unit_price: Number(i.unit_price) || 0, vat_rate: Number(i.vat_rate) || 20 })) : [emptyItem()]);
      } else if (kind === "project") {
        const rows = await get<ProjectDoc[]>(client, "/projects", { company_id: companyId, light: 1 });
        const p = (rows || []).find((x) => idOf(x) === docId) || null;
        if (!p) { setError("Proje bulunamadı."); return; }
        setProject(p);
        setName(p.name || "");
        setContactId(p.contact_id || "");
        setContactName(p.contact_name || "");
        setBudget(String(p.budget ?? ""));
        setStartDate(String(p.start_date || "").slice(0, 10));
        setEndDate(String(p.end_date || "").slice(0, 10));
        setNotes(p.description || "");
        setAddress(p.address || "");
        setLocation({ url: p.location_url || "", lat: coordText(p.latitude), lng: coordText(p.longitude) });
        setPhotos(p.images || []);
        setStatus(p.status || "planning");
        const expList = await get<{ expenses?: Expense[] }>(client, "/expenses", { company_id: companyId, project_id: docId }).catch(() => ({ expenses: [] }));
        setProjectExpenses(expList.expenses || []);
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
  const statuses = kind === "quote" ? QUOTE_STATUSES : kind === "project" ? PROJECT_STATUSES : SURVEY_STATUSES;

  const patchItem = (i: number, field: keyof WorkItem, value: string | number) => {
    setItems((rows) => rows.map((it, idx) => (idx === i ? { ...it, [field]: value } : it)));
  };

  const removeItem = (i: number) => {
    if (!canEdit) return;
    setItems((rows) => removeWorkItem(rows, i));
  };

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
        if (isNew) {
          const created = await post<QuoteDoc>(client, "/quotes", quotePayload(companyId, form, pricedItems));
          router.replace({ pathname: "/quotes/[id]", params: { id: idOf(created) } });
        } else {
          await put(client, `/quotes/${docId}`, quoteUpdateBody(form, pricedItems));
          if (status !== (quote?.status || "draft")) await put(client, `/quotes/${docId}`, { status });
          setMessage("Teklif güncellendi.");
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

  const convertInvoice = async () => {
    if (!docId || kind !== "quote") return;
    setBusy(true);
    try {
      const r = await post<{ message?: string }>(client, `/quotes/${docId}/convert-to-invoice`);
      setMessage(r.message || "Taslak fatura oluşturuldu.");
      await loadDoc();
    } catch (err) {
      setError(apiErrorMessage(err, "Faturaya çevrilemedi."));
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

  return (
    <Screen>
      <H1>{heading}</H1>
      <Muted>{kind === "quote" ? "Cari ve kalemlerle fiyat teklifi." : kind === "project" ? "İş / saha projesi, bütçe ve cari." : "Keşif, ölçü ve teklife dönüştürme."}</Muted>
      <ErrorBanner message={error} />
      {message ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{message}</Text> : null}
      {!isNew && kind === "project" && (canExp || canEdit) ? (
        <PrimaryButton title="Masraf ekle" color={colors.danger} testID="project-expense-btn" onPress={openProjectExpense} />
      ) : null}

      {kind === "quote" ? <Field label="Başlık" testID="q-title" value={title} onChangeText={setTitle} editable={canEdit} /> : null}
      {kind === "project" ? <Field label="Proje adı" testID="p-name" value={name} onChangeText={setName} editable={canEdit} /> : null}

      <Muted>Cari</Muted>
      {contactId ? (
        <ListRow title={contactName || "Cari"} subtitle="Değiştirmek için dokunun" onPress={() => { setContactId(""); setContactName(""); }} />
      ) : (
        <>
          <Field label="Cari ara" value={custQ} onChangeText={setCustQ} placeholder="Ad / telefon" />
          {custHits.map((c) => (
            <ListRow key={idOf(c)} title={c.name} subtitle={c.phone || c.city} onPress={() => { setContactId(idOf(c)); setContactName(c.name); setAddress((a) => a || c.address || ""); setCustQ(""); }} />
          ))}
        </>
      )}

      {kind === "quote" ? <Field label="Geçerlilik" testID="q-valid" value={validUntil} onChangeText={setValidUntil} placeholder="YYYY-MM-DD" editable={canEdit} /> : null}
      {kind === "project" ? (
        <>
          <Field label="Bütçe" testID="p-budget" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" editable={canEdit} />
          <Field label="Başlangıç" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" editable={canEdit} />
          <Field label="Bitiş" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" editable={canEdit} />
        </>
      ) : null}
      {kind === "survey" ? <Field label="Keşif tarihi" testID="s-date" value={surveyDate} onChangeText={setSurveyDate} placeholder="YYYY-MM-DD" editable={canEdit} /> : null}
      {kind !== "quote" ? <Field label="Adres" value={address} onChangeText={setAddress} editable={canEdit} /> : null}
      {kind !== "quote" ? (
        <LocationPicker label="Konum" value={location} onChange={setLocation} editable={canEdit} testID="work-location" />
      ) : null}

      {kind !== "quote" ? (
        <ImageUploader
          entity={kind}
          entityId={docId}
          images={photos}
          onUploaded={(url) => setPhotos((prev) => [...prev, url])}
          editable={canEdit}
          label={kind === "survey" ? "Keşif fotoğrafları" : "Proje fotoğrafları"}
          hint="Yüklenen fotoğraflar web’deki keşif / proje kartında da görünür."
          testID="work-photos"
        />
      ) : null}

      {!isNew ? (
        <>
          <Muted>Durum · {statusTr(status)}</Muted>
          <Row style={{ flexWrap: "wrap" }}>
            {statuses.map((s) => (
              <Chip key={s.key} label={s.label} active={status === s.key} onPress={() => canEdit && setStatus(s.key)} />
            ))}
          </Row>
        </>
      ) : null}

      {kind !== "project" ? (
        <Card>
          <Text style={{ fontWeight: "800", color: colors.text }}>{kind === "survey" ? "Ölçüler" : "Kalemler"}</Text>
          <Field label="Ürün ara" value={prodQ} onChangeText={setProdQ} placeholder="Ad / SKU" />
          {prodHits.map((p) => (
            <ProductPickRow
              key={idOf(p)}
              product={p}
              testID={`q-prod-${idOf(p)}`}
              onPress={() => {
                setItems((rows) => {
                  const emptyIdx = rows.findIndex((it) => !it.name);
                  const line = workItemFromProduct(p);
                  if (emptyIdx >= 0) return rows.map((it, i) => (i === emptyIdx ? line : it));
                  return [...rows, line];
                });
                setProdQ("");
              }}
            />
          ))}
          {items.map((it, i) => (
            <View
              key={i}
              testID={`q-item-row-${i}`}
              style={{
                ...itemStripe(i),
                borderRadius: 10,
                paddingHorizontal: 8,
                paddingVertical: 8,
                flexDirection: "row",
                flexWrap: "nowrap",
                alignItems: "flex-start",
                gap: 6,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Field compact label="Ad" testID={`q-item-name-${i}`} value={it.name} onChangeText={(v) => patchItem(i, "name", v)} editable={canEdit} />
              </View>
              <View style={{ width: 58, flexShrink: 0 }}>
                <Field compact label="Miktar" testID={`q-item-qty-${i}`} value={String(it.quantity)} onChangeText={(v) => patchItem(i, "quantity", n(v))} keyboardType="decimal-pad" editable={canEdit} />
              </View>
              <View style={{ width: 86, flexShrink: 0 }}>
                <Field compact label="Birim fiyat" testID={`q-item-price-${i}`} value={String(it.unit_price)} onChangeText={(v) => patchItem(i, "unit_price", n(v))} keyboardType="decimal-pad" editable={canEdit} />
              </View>
              {canEdit ? (
                <Pressable
                  onPress={() => removeItem(i)}
                  testID={`q-item-del-${i}`}
                  accessibilityLabel="Kalemi sil"
                  style={{ width: 36, height: 40, marginTop: 18, alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.danger} />
                </Pressable>
              ) : null}
            </View>
          ))}
          <PrimaryButton title="Kalem ekle" color={colors.indigo} testID="q-add-item-btn" onPress={() => setItems((rows) => [...rows, emptyItem()])} />
          {namedItems(items).length ? (
            <Row style={{ justifyContent: "space-between" }}>
              <Text style={{ fontWeight: "800" }}>Toplam</Text>
              <Text style={{ fontWeight: "800", color: colors.primary }}>{fmtMoney(totals.grandTotal)}</Text>
            </Row>
          ) : null}
        </Card>
      ) : null}

      <Field label="Not" value={notes} onChangeText={setNotes} editable={canEdit} />
      <PrimaryButton title={busy ? "Kaydediliyor…" : isNew ? "Kaydet" : "Güncelle"} onPress={save} loading={busy} disabled={!canEdit} color={colors.primary} testID={`${kind}-save`} />

      {!isNew && kind === "survey" && !survey?.quote_id && canEdit ? (
        <PrimaryButton title="Teklife dönüştür" onPress={() => confirmAction("Teklif", "Keşif teklife dönüştürülsün mü?", convert)} color={colors.indigo} testID="survey-to-quote" />
      ) : null}
      {!isNew && kind === "quote" && !quote?.project_id && canEdit ? (
        <PrimaryButton title="Projeye dönüştür" onPress={() => confirmAction("Proje", "Teklif projeye dönüştürülsün mü?", convert)} color={colors.indigo} testID="quote-to-project" />
      ) : null}
      {!isNew && kind === "quote" && !quote?.invoice_id && canEdit ? (
        <PrimaryButton title="Faturaya dönüştür" onPress={convertInvoice} color={colors.primary} testID="quote-to-invoice" />
      ) : null}
      {!isNew && kind === "project" && project?.can_invoice && canEdit ? (
        <PrimaryButton title="Projeyi faturalandır" onPress={convert} color={colors.primary} testID="project-invoice" />
      ) : null}
      {kind === "project" && project ? (
        <Card>
          <Muted>Teklif {fmtMoney(project.quoted_total)} · Fatura {fmtMoney(project.invoiced_total)} · Masraf {fmtMoney(project.expense_total)}</Muted>
          {projectExpenses.map((e) => (
            <ListRow
              key={idOf(e)}
              testID={`project-expense-${idOf(e)}`}
              title={e.description || e.expense_number || "Masraf"}
              subtitle={`${e.expense_number || ""} · ${e.category || ""} · ${statusTr(e.payment_status)} · ${fmtMoney(e.total ?? e.amount)}`}
              onPress={() => router.push({ pathname: "/expenses/[id]", params: { id: idOf(e) } })}
            />
          ))}
          {!isNew && (canExp || canEdit) ? (
            <PrimaryButton title="Masraf ekle" color={colors.danger} testID="project-expense-card-btn" onPress={openProjectExpense} />
          ) : null}
        </Card>
      ) : null}
      {!isNew && kind === "quote" && quote ? (
        <QuoteActions
          quote={{ ...quote, title, contact_name: contactName, valid_until: validUntil, notes, items, grand_total: totals.grandTotal }}
          contact={contacts.find((c) => idOf(c) === contactId) || null}
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
    </Screen>
  );
}
