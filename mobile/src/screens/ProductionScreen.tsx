import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { get, post } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ProductionAiAdvisor } from "../components/ProductionAiAdvisor";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { Chip } from "../components/chips";
import { DateField } from "../components/DateField";
import { GroupedSelect } from "../components/GroupedSelect";
import { Badge, Card, Empty, ErrorBanner, Field, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { fmtDate, fmtMoney, idOf, todayIso } from "../utils/money";
import {
  formatBomQty,
  productionOrderStatus,
  recipeIdOf,
  type ProductionKpis,
  type ProductionOrder,
  type ProductionRecipe,
  type Requirements,
} from "../utils/production";

type Tab = "orders" | "recipes";

export function ProductionScreen() {
  const { client, companyId, can } = useAuth();
  const canEdit = can("/production", "edit");
  const [tab, setTab] = useState<Tab>("orders");
  const [filter, setFilter] = useState<"open" | "all" | "planned" | "in_production" | "completed">("open");
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [recipes, setRecipes] = useState<ProductionRecipe[]>([]);
  const [kpis, setKpis] = useState<ProductionKpis>({});
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [qty, setQty] = useState("1");
  const [planDate, setPlanDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [req, setReq] = useState<Requirements | null>(null);
  const [recipeDetail, setRecipeDetail] = useState<ProductionRecipe | null>(null);

  const loadOrders = useCallback(async () => {
    const statusQs = filter === "open" ? "open" : filter === "all" ? undefined : filter;
    const o = await get<ProductionOrder[]>(client, "/production/orders", {
      company_id: companyId,
      status: statusQs,
      include_steps: 1,
    });
    setOrders(o || []);
  }, [client, companyId, filter]);

  const loadRecipes = useCallback(async () => {
    const r = await get<ProductionRecipe[]>(client, "/production/recipes", { company_id: companyId });
    setRecipes(r || []);
  }, [client, companyId]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadOrders();
      const k = await get<ProductionKpis>(client, "/production/kpis", { company_id: companyId }).catch(() => null);
      if (k) setKpis(k);
      if (tab === "recipes" || orderOpen) await loadRecipes();
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Üretim verileri yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, loadOrders, loadRecipes, orderOpen, tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useFocusEffect(useCallback(() => {
    if (tab === "recipes") loadRecipes().catch(() => null);
  }, [tab, loadRecipes]));

  const loadRequirements = useCallback(async (rid: string, quantity: number) => {
    if (!rid || !(quantity > 0)) {
      setReq(null);
      return;
    }
    try {
      const r = await get<Requirements>(client, "/production/requirements", { recipe_id: rid, quantity });
      setReq(r);
    } catch {
      setReq(null);
    }
  }, [client]);

  const openNewOrder = async () => {
    setNotice(null);
    setError(null);
    setQty("1");
    setPlanDate(todayIso());
    setNotes("");
    setReq(null);
    try {
      await loadRecipes();
      const active = (recipes.length ? recipes : await get<ProductionRecipe[]>(client, "/production/recipes", { company_id: companyId }) || [])
        .filter((r) => r.is_active !== false);
      if (!recipes.length) setRecipes(active);
      const first = active[0];
      const rid = recipeIdOf(first);
      setRecipeId(rid);
      setOrderOpen(true);
      if (rid) loadRequirements(rid, 1);
    } catch (err) {
      setError(apiErrorMessage(err, "Reçeteler yüklenemedi."));
    }
  };

  const submitOrder = async () => {
    if (!recipeId) {
      setError("Reçete seçin.");
      return;
    }
    const planned = Number(String(qty).replace(",", "."));
    if (!(planned > 0)) {
      setError("Miktar 0'dan büyük olmalı.");
      return;
    }
    setBusyId("new");
    try {
      const r = await post<{ message?: string }>(client, "/production/orders", {
        company_id: companyId,
        recipe_id: recipeId,
        planned_quantity: planned,
        planned_date: planDate,
        notes,
        source: "manual",
      });
      setNotice(r.message || "Üretim emri oluşturuldu.");
      setOrderOpen(false);
      setTab("orders");
      await loadOrders();
    } catch (err) {
      setError(apiErrorMessage(err, "Üretim emri oluşturulamadı."));
    } finally {
      setBusyId(null);
    }
  };

  const act = async (o: ProductionOrder, action: "start" | "complete" | "cancel", body?: Record<string, unknown>) => {
    const id = idOf(o);
    if (!id) return;
    setBusyId(id);
    try {
      const r = await post<{ message?: string }>(client, `/production/orders/${id}/${action}`, body || {});
      setNotice(r.message || "İşlem tamam.");
      setError(null);
      await loadOrders();
    } catch (err) {
      setError(apiErrorMessage(err, "İşlem başarısız."));
    } finally {
      setBusyId(null);
    }
  };

  const openRecipeBom = async (r: ProductionRecipe) => {
    const id = recipeIdOf(r);
    try {
      const full = await get<ProductionRecipe>(client, `/production/recipes/${id}`);
      setRecipeDetail(full || r);
    } catch {
      setRecipeDetail(r);
    }
  };

  const filteredOrders = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return orders;
    return orders.filter((o) =>
      [o.order_code, o.finished_product_name, o.recipe_name, o.notes].some((v) => String(v || "").toLowerCase().includes(s))
    );
  }, [orders, q]);

  const filteredRecipes = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = recipes.filter((r) => r.is_active !== false);
    if (!s) return list;
    return list.filter((r) =>
      [r.code, r.name, r.finished_product_name, r.contact_name, r.job_file_name].some((v) => String(v || "").toLowerCase().includes(s))
    );
  }, [q, recipes]);

  const recipeGroups = useMemo(() => [{
    label: "Reçeteler",
    options: recipes.filter((r) => r.is_active !== false).map((r) => ({
      value: recipeIdOf(r),
      label: `${r.name || r.code || "Reçete"}${r.finished_product_name ? ` · ${r.finished_product_name}` : ""}`,
    })),
  }], [recipes]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <ProductionAiAdvisor companyId={companyId} compact />
      <Row style={{ gap: 8, flexWrap: "wrap" }}>
        {canEdit ? (
          <View style={{ flex: 1, minWidth: 140 }}>
            <PrimaryButton title="Üretim Emri Ver" onPress={openNewOrder} color={colors.primary} testID="prod-new-order" />
          </View>
        ) : null}
        <View style={{ flex: 1, minWidth: 140 }}>
          <PrimaryButton title="Atölye Ekranı" onPress={() => go("Atolye")} color="#EA580C" testID="prod-goto-atolye" />
        </View>
      </Row>
      <Card testID="prod-kpis">
        <Row style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <Muted>Açık {kpis.open ?? 0}</Muted>
          <Muted>Üretimde {kpis.in_production ?? 0}</Muted>
          <Muted>Bu ay {kpis.completed_this_month ?? 0}</Muted>
          <Muted>Reçete {kpis.recipes ?? recipes.length}</Muted>
        </Row>
      </Card>
      <Row style={{ gap: 8 }}>
        <Chip label="Üretim Emirleri" active={tab === "orders"} onPress={() => setTab("orders")} testID="prod-tab-orders" />
        <Chip label="Reçeteler (BOM)" active={tab === "recipes"} onPress={() => setTab("recipes")} testID="prod-tab-recipes" />
      </Row>
      <Field label="Ara" value={q} onChangeText={setQ} placeholder={tab === "orders" ? "Emir / ürün / reçete" : "Reçete / mamul / müşteri"} testID="prod-search" />
      {tab === "orders" ? (
        <Row style={{ flexWrap: "wrap", gap: 6 }}>
          {([
            ["open", "Açık"],
            ["planned", "Planlandı"],
            ["in_production", "Üretimde"],
            ["completed", "Bitti"],
            ["all", "Tümü"],
          ] as const).map(([k, l]) => (
            <Chip key={k} label={l} active={filter === k} onPress={() => setFilter(k)} testID={`prod-filter-${k}`} />
          ))}
        </Row>
      ) : null}
      <ErrorBanner message={error} />
      {notice ? <Text style={{ color: colors.primaryHover, fontWeight: "700" }}>{notice}</Text> : null}

      {tab === "orders" ? (
        !filteredOrders.length ? (
          <Empty icon="construct-outline" title="Üretim emri yok" hint="Reçete seçip emir verin; atölye ekranında adımlar görünür." />
        ) : (
          filteredOrders.map((o) => {
            const st = productionOrderStatus(o.status);
            const oid = idOf(o);
            const remaining = Math.max(0, Number(o.planned_quantity || 0) - Number(o.completed_quantity || 0));
            return (
              <Card key={oid} testID={`prod-order-${o.order_code || oid}`}>
                <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Muted>{o.order_code}</Muted>
                    <Text style={{ fontWeight: "800", color: colors.text }} numberOfLines={2}>{o.finished_product_name || "Ürün"}</Text>
                    <Muted>{o.recipe_name || "Reçete"}{o.planned_date ? ` · ${fmtDate(o.planned_date)}` : ""}</Muted>
                  </View>
                  <Badge label={st.label} tone={st.tone} />
                </Row>
                <Muted>
                  Plan {formatBomQty(o.planned_quantity)} {o.unit || ""} · üretilen {formatBomQty(o.completed_quantity)} · kalan {formatBomQty(remaining)}
                  {o.estimated_total_cost != null ? ` · ~${fmtMoney(o.estimated_total_cost)}` : ""}
                </Muted>
                {(o.shortages || []).length > 0 && o.status !== "completed" ? (
                  <Text style={{ color: "#BE123C", fontWeight: "700", fontSize: 12 }}>{(o.shortages || []).length} hammadde eksik</Text>
                ) : null}
                {canEdit ? (
                  <Row style={{ gap: 8, marginTop: 4 }}>
                    {o.status === "planned" ? (
                      <View style={{ flex: 1 }}>
                        <PrimaryButton title="Başlat" onPress={() => act(o, "start")} loading={busyId === oid} disabled={!!busyId} color={colors.primary} testID={`prod-start-${o.order_code}`} />
                      </View>
                    ) : null}
                    {o.status === "in_production" || o.status === "planned" ? (
                      <View style={{ flex: 1 }}>
                        <PrimaryButton
                          title="Tamamla"
                          onPress={() => act(o, "complete", { quantity: remaining || o.planned_quantity || 1 })}
                          loading={busyId === oid}
                          disabled={!!busyId}
                          color="#059669"
                          testID={`prod-complete-${o.order_code}`}
                        />
                      </View>
                    ) : null}
                  </Row>
                ) : null}
              </Card>
            );
          })
        )
      ) : (
        !filteredRecipes.length ? (
          <Empty icon="book-outline" title="Reçete (BOM) yok" hint="Web’den Yeni Reçete ile ürün ağacını tanımlayın; burada listelenir." />
        ) : (
          filteredRecipes.map((r) => {
            const rid = recipeIdOf(r);
            const mats = r.materials || [];
            return (
              <Card key={rid} testID={`prod-recipe-${r.code || rid}`}>
                <Pressable onPress={() => openRecipeBom(r)} testID={`prod-recipe-open-${r.code || rid}`}>
                  <Muted>{r.code}</Muted>
                  <Text style={{ fontWeight: "800", color: colors.text }} numberOfLines={2}>{r.name || "Reçete"}</Text>
                  <Muted>
                    {r.finished_product_name || "Mamul"} · {formatBomQty(r.target_quantity)} {r.unit || "Adet"}
                    {r.unit_cost != null ? ` · birim ${fmtMoney(r.unit_cost)}` : ""}
                  </Muted>
                  {r.contact_name || r.job_file_name ? (
                    <Muted>{[r.contact_name ? `Müşteri: ${r.contact_name}` : null, r.job_file_name ? `İş: ${r.job_file_name}` : null].filter(Boolean).join(" · ")}</Muted>
                  ) : null}
                </Pressable>
                <View
                  testID={`prod-recipe-bom-${r.code || rid}`}
                  style={{ marginTop: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.slate50, padding: 8, gap: 4 }}
                >
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text }}>BOM · Hammaddeler ({mats.length})</Text>
                  {mats.length ? mats.slice(0, 6).map((m, i) => (
                    <Row key={`${m.product_id || i}`} style={{ justifyContent: "space-between", gap: 8 }}>
                      <Text style={{ flex: 1, fontSize: 12, color: colors.muted }} numberOfLines={1}>{m.product_name || "Hammadde"}</Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.text }}>
                        {formatBomQty(m.quantity)} {m.unit || ""}
                        {m.wastage_percent ? ` (+%${m.wastage_percent})` : ""}
                      </Text>
                    </Row>
                  )) : <Muted>Hammadde satırı yok</Muted>}
                  {mats.length > 6 ? <Muted>+{mats.length - 6} kalem daha</Muted> : null}
                </View>
                {canEdit ? (
                  <PrimaryButton
                    title="Bu reçeteden üret"
                    onPress={() => {
                      setRecipeId(rid);
                      setQty(String(r.target_quantity || 1));
                      setPlanDate(todayIso());
                      setNotes("");
                      setOrderOpen(true);
                      loadRequirements(rid, Number(r.target_quantity) || 1);
                    }}
                    color={colors.slate800}
                    testID={`prod-recipe-produce-${r.code || rid}`}
                  />
                ) : null}
              </Card>
            );
          })
        )
      )}

      <B2BSheet
        visible={orderOpen}
        title="Üretim Emri Ver"
        subtitle="Reçete (BOM) seçin; hammadde ihtiyacı hesaplanır"
        onClose={() => setOrderOpen(false)}
        testID="prod-order-sheet"
      >
        <GroupedSelect
          label="Reçete"
          testID="prod-order-recipe"
          value={recipeId}
          onChange={(v) => {
            setRecipeId(v);
            loadRequirements(v, Number(String(qty).replace(",", ".")) || 1);
          }}
          groups={recipeGroups}
          emptyLabel="Reçete seçin…"
        />
        <Field
          label="Miktar"
          testID="prod-order-qty"
          value={qty}
          onChangeText={(v) => {
            setQty(v);
            loadRequirements(recipeId, Number(String(v).replace(",", ".")) || 0);
          }}
          keyboardType="decimal-pad"
        />
        <DateField label="Planlanan tarih" testID="prod-order-date" value={planDate} onChangeText={setPlanDate} />
        <Field label="Not" testID="prod-order-notes" value={notes} onChangeText={setNotes} placeholder="Operatör, vardiya…" />
        {req?.rows?.length ? (
          <View testID="prod-order-requirements" style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 6 }}>
            <Text style={{ fontWeight: "800", color: colors.text }}>Hammadde ihtiyacı</Text>
            {req.estimated_total_cost != null ? <Muted>Tahmini maliyet {fmtMoney(req.estimated_total_cost)}</Muted> : null}
            {req.rows.map((row) => (
              <Row key={row.product_id} style={{ justifyContent: "space-between", gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 12, color: colors.muted }} numberOfLines={1}>{row.product_name}</Text>
                <Text style={{ fontSize: 12, fontWeight: "700", color: (row.shortage || 0) > 0 ? "#BE123C" : colors.text }}>
                  {formatBomQty(row.needed)} / stok {formatBomQty(row.in_stock)} {row.unit || ""}
                </Text>
              </Row>
            ))}
            {req.has_shortage ? <Text style={{ color: "#BE123C", fontWeight: "700", fontSize: 12 }}>Eksik hammadde var — emir yine açılabilir.</Text> : null}
          </View>
        ) : null}
        <PrimaryButton title={busyId === "new" ? "Kaydediliyor…" : "Emri Oluştur"} onPress={submitOrder} loading={busyId === "new"} disabled={!canEdit} color={colors.primary} testID="prod-order-submit" />
      </B2BSheet>

      <Modal visible={!!recipeDetail} transparent animationType="slide" onRequestClose={() => setRecipeDetail(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.45)", justifyContent: "flex-end" }} onPress={() => setRecipeDetail(null)}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", padding: 16 }}
            testID="prod-recipe-detail"
          >
            <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text }}>{recipeDetail?.name || "Reçete"}</Text>
            <Muted>{recipeDetail?.code} · {recipeDetail?.finished_product_name}</Muted>
            <ScrollView style={{ marginTop: 12 }}>
              {(recipeDetail?.materials || []).map((m, i) => (
                <Row key={`${m.product_id || i}`} style={{ justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.slate100 }}>
                  <Text style={{ flex: 1, fontWeight: "600", color: colors.text }}>{m.product_name}</Text>
                  <Text style={{ fontWeight: "800", color: colors.text }}>{formatBomQty(m.quantity)} {m.unit || ""}</Text>
                </Row>
              ))}
            </ScrollView>
            <PrimaryButton title="Kapat" onPress={() => setRecipeDetail(null)} color={colors.secondary} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
