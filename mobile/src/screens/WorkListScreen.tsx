import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { Badge, Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { statusTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { newButtonLabel, projectCardBits, type ProjectDoc, type QuoteDoc, type SurveyDoc, type WorkKind } from "../utils/workDocs";

const META: Record<WorkKind, { path: string; perm: string; empty: string; icon: "document-text-outline" | "briefcase-outline" | "construct-outline"; goNew: string; goDetail: string }> = {
  quote: { path: "/quotes", perm: "/quotes", empty: "Teklif yok", icon: "document-text-outline", goNew: "QuoteNew", goDetail: "QuoteDetail" },
  project: { path: "/projects", perm: "/projects", empty: "Proje yok", icon: "briefcase-outline", goNew: "ProjectNew", goDetail: "ProjectDetail" },
  survey: { path: "/surveys", perm: "/surveys", empty: "Keşif yok", icon: "construct-outline", goNew: "SurveyNew", goDetail: "SurveyDetail" },
};

export function WorkListScreen({ kind }: { kind: WorkKind }) {
  const meta = META[kind];
  const { client, companyId, can } = useAuth();
  const canEdit = can(meta.perm, "edit");
  const canExp = can("/expenses", "edit");
  const canQuote = can("/quotes", "edit");
  const [quotes, setQuotes] = useState<QuoteDoc[]>([]);
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [surveys, setSurveys] = useState<SurveyDoc[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      if (kind === "quote") {
        const rows = await get<QuoteDoc[]>(client, "/quotes", { company_id: companyId, summary: 1 });
        setQuotes(rows || []);
      } else if (kind === "project") {
        const rows = await get<ProjectDoc[]>(client, "/projects", { company_id: companyId, light: 1 });
        setProjects(rows || []);
      } else {
        const rows = await get<SurveyDoc[]>(client, "/surveys", { company_id: companyId });
        setSurveys(rows || []);
      }
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Liste yüklenemedi."));
    } finally {
      setRefreshing(false);
    }
  }, [client, companyId, kind]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (kind === "quote") {
      const list = s ? quotes.filter((r) => [r.quote_number, r.title, r.contact_name].some((v) => String(v || "").toLowerCase().includes(s))) : quotes;
      return list.slice(0, 80).map((r) => ({
        id: idOf(r),
        title: r.quote_number || r.title || "Teklif",
        subtitle: `${r.contact_name || "—"} · ${statusTr(r.status)} · ${fmtDate(r.valid_until)}`,
        right: fmtMoney(r.grand_total),
        project: undefined as ProjectDoc | undefined,
      }));
    }
    if (kind === "project") {
      const list = s ? projects.filter((r) => [r.project_number, r.name, r.contact_name, r.quote_number, r.address].some((v) => String(v || "").toLowerCase().includes(s))) : projects;
      return list.slice(0, 80).map((r) => ({ id: idOf(r), title: r.name || "", subtitle: "", right: "", project: r }));
    }
    const list = s ? surveys.filter((r) => [r.survey_number, r.contact_name, r.address].some((v) => String(v || "").toLowerCase().includes(s))) : surveys;
      return list.slice(0, 80).map((r) => ({
        id: idOf(r),
        title: r.survey_number || "Keşif",
        subtitle: `${r.contact_name || "—"} · ${r.address || ""} · ${statusTr(r.status)} · ${fmtDate(r.survey_date)}`,
        right: "",
        project: undefined as ProjectDoc | undefined,
      }));
  }, [kind, q, quotes, projects, surveys]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      {canEdit ? (
        <PrimaryButton title={newButtonLabel(kind)} onPress={() => go(meta.goNew)} color={colors.primary} testID={`new-${kind}-btn`} />
      ) : null}
      <Field label="Ara" value={q} onChangeText={setQ} placeholder="No / cari / ad" />
      <ErrorBanner message={error} />
      {!filtered.length ? (
        <Empty icon={meta.icon} title={meta.empty} hint={canEdit ? `${newButtonLabel(kind)} ile başlayın.` : undefined} />
      ) : kind === "project" ? filtered.map((r) => (
        <ProjectCard
          key={r.id}
          project={r.project!}
          canExp={canExp}
          canQuote={canQuote}
        />
      )) : filtered.map((r) => (
        <ListRow
          key={r.id}
          testID={`${kind}-row-${r.id}`}
          title={r.title}
          subtitle={r.subtitle}
          right={r.right || undefined}
          onPress={() => go(meta.goDetail, { id: r.id })}
        />
      ))}
    </Screen>
  );
}

function Metric({ label, value, testID, tone }: { label: string; value: string; testID?: string; tone?: "green" }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.slate50, borderRadius: 10, padding: 8, minWidth: 0 }}>
      <Muted>{label}</Muted>
      <Text testID={testID} numberOfLines={1} style={{ fontWeight: "800", fontSize: 12, color: tone === "green" ? colors.primaryHover : colors.text }}>{value}</Text>
    </View>
  );
}

function ProjectCard({
  project,
  canExp,
  canQuote,
}: {
  project: ProjectDoc;
  canExp: boolean;
  canQuote: boolean;
}) {
  const id = idOf(project);
  const bits = projectCardBits(project);
  return (
    <Card testID={`project-row-${id}`}>
      <Pressable onPress={() => go("ProjectDetail", { id })}>
        {bits.codes ? <Muted>{bits.codes}</Muted> : null}
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <Text style={{ flex: 1, fontWeight: "800", color: colors.text, fontSize: 15 }} numberOfLines={2}>{bits.name}</Text>
          <Badge label={statusTr(project.status)} tone={project.status === "completed" ? "green" : project.status === "on_hold" ? "amber" : "slate"} />
        </Row>
        <Muted>{bits.contact}</Muted>
        <Row style={{ alignItems: "stretch", gap: 6, marginTop: 4 }}>
          <Metric label="Bütçe" value={fmtMoney(bits.budget)} testID={`project-budget-${id}`} />
          <Metric label="Teklif" value={`${bits.quoteCount} · ${fmtMoney(bits.quoted)}`} testID={`project-quoted-${id}`} />
          <Metric label="Faturalanan" value={fmtMoney(bits.invoiced)} testID={`project-invoiced-${id}`} tone="green" />
        </Row>
        {bits.expense > 0 ? <Muted>Masraf {fmtMoney(bits.expense)}</Muted> : null}
      </Pressable>
      {canExp || canQuote ? (
        <Row style={{ flexWrap: "wrap", marginTop: 4 }}>
          {canExp ? (
            <Pressable
              testID={`project-expense-${id}`}
              onPress={() => go("ProjectDetail", { id, open_expense: "1" })}
              style={{ flex: 1, minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.rose50, borderWidth: 1, borderColor: "#FECDD3" }}
            >
              <Text style={{ fontWeight: "800", color: "#9F1239", fontSize: 12 }}>Masraf Ekle</Text>
            </Pressable>
          ) : null}
          {canQuote ? (
            <Pressable
              testID={`project-quote-${id}`}
              onPress={() => go("QuoteNew", {
                contact_id: project.contact_id || "",
                contact_name: project.contact_name || "",
                project_id: id,
                title: `${bits.name} teklifi`,
              })}
              style={{ flex: 1, minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary }}
            >
              <Text style={{ fontWeight: "800", color: "#fff", fontSize: 12 }}>Teklif Oluştur</Text>
            </Pressable>
          ) : null}
        </Row>
      ) : null}
    </Card>
  );
}
