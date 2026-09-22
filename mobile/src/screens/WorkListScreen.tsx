import { useFocusEffect } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { get } from "../api/client";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { ProjectCardsHost, openWorkLocation } from "../components/ProjectCard";
import { Badge, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { statusTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { mapsLink } from "../utils/geo";
import { isCompletedProjectStatus, normalizeProjectStages, type ProjectStage } from "../utils/projectStages";
import {
  SURVEY_MAPS_ACTION,
  asWorkList,
  newButtonLabel,
  quoteListSubtitle,
  quoteListTitle,
  quoteStatusTone,
  isSurveyConverted,
  surveyListSubtitle,
  surveyStatusTone,
  type ProjectDoc,
  type QuoteDoc,
  type SurveyDoc,
  type WorkKind,
} from "../utils/workDocs";

const META: Record<WorkKind, { path: string; perm: string; empty: string; icon: "document-text-outline" | "briefcase-outline" | "construct-outline"; goNew: string; goDetail: string }> = {
  quote: { path: "/quotes", perm: "/quotes", empty: "Teklif yok", icon: "document-text-outline", goNew: "QuoteNew", goDetail: "QuoteDetail" },
  project: { path: "/projects", perm: "/projects", empty: "Proje yok", icon: "briefcase-outline", goNew: "ProjectNew", goDetail: "ProjectDetail" },
  survey: { path: "/surveys", perm: "/surveys", empty: "Keşif yok", icon: "construct-outline", goNew: "SurveyNew", goDetail: "SurveyDetail" },
};

export function WorkListScreen({ kind }: { kind: WorkKind }) {
  const meta = META[kind];
  const { client, companyId, can, baseUrl } = useAuth();
  const canEdit = can(meta.perm, "edit");
  const canExp = can("/expenses", "edit");
  const canQuote = can("/quotes", "edit");
  const canBank = can("/banking", "edit");
  const [quotes, setQuotes] = useState<QuoteDoc[]>([]);
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [surveys, setSurveys] = useState<SurveyDoc[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [projectStages, setProjectStages] = useState<ProjectStage[]>([]);
  const loadGen = useRef(0);

  const load = useCallback(async () => {
    if (!companyId) return;
    const gen = ++loadGen.current;
    setRefreshing(true);
    try {
      if (kind === "quote") {
        const rows = asWorkList<QuoteDoc>(await get(client, "/quotes", { company_id: companyId, summary: 1 }));
        if (gen !== loadGen.current) return;
        setQuotes(rows);
      } else if (kind === "project") {
        const [rows, stages] = await Promise.all([
          get(client, "/projects", { company_id: companyId, light: 1 }),
          get<{ stages?: ProjectStage[] }>(client, `/companies/${companyId}/project-stages`).catch(() => ({ stages: [] })),
        ]);
        if (gen !== loadGen.current) return;
        setProjects(asWorkList<ProjectDoc>(rows));
        setProjectStages(normalizeProjectStages(stages?.stages));
      } else {
        const rows = asWorkList<SurveyDoc>(await get(client, "/surveys", { company_id: companyId }));
        if (gen !== loadGen.current) return;
        setSurveys(rows);
      }
      setError(null);
    } catch (err) {
      if (gen !== loadGen.current) return;
      setError(apiErrorMessage(err, "Liste yüklenemedi."));
    } finally {
      if (gen === loadGen.current) setRefreshing(false);
    }
  }, [client, companyId, kind]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patchProject = useCallback((id: string, patch: Partial<ProjectDoc>) => {
    setProjects((rows) => rows.map((p) => (idOf(p) === id ? { ...p, ...patch } : p)));
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (kind === "quote") {
      const list = s ? quotes.filter((r) => [r.quote_number, r.title, r.contact_name].some((v) => String(v || "").toLowerCase().includes(s))) : quotes;
      return list.slice(0, 80).map((r) => ({
        id: idOf(r),
        title: quoteListTitle(r),
        subtitle: quoteListSubtitle(r),
        right: fmtMoney(r.grand_total),
        quote: r,
        survey: undefined as SurveyDoc | undefined,
        project: undefined as ProjectDoc | undefined,
      }));
    }
    if (kind === "project") {
      const pool = showCompleted ? projects : projects.filter((r) => !isCompletedProjectStatus(r.status, projectStages));
      const list = s ? pool.filter((r) => [r.project_number, r.name, r.contact_name, r.quote_number, r.address].some((v) => String(v || "").toLowerCase().includes(s))) : pool;
      return list.slice(0, 80).map((r) => ({ id: idOf(r), title: r.name || "", subtitle: "", right: "", quote: undefined as QuoteDoc | undefined, survey: undefined as SurveyDoc | undefined, project: r }));
    }
    const open = surveys.filter((r) => !isSurveyConverted(r));
    const list = s ? open.filter((r) => [r.survey_number, r.contact_name, r.address].some((v) => String(v || "").toLowerCase().includes(s))) : open;
    return list.slice(0, 80).map((r) => ({
      id: idOf(r),
      title: r.survey_number || "Keşif",
      subtitle: surveyListSubtitle(r),
      right: "",
      quote: undefined as QuoteDoc | undefined,
      survey: r,
      project: undefined as ProjectDoc | undefined,
    }));
  }, [kind, q, quotes, projects, surveys, showCompleted, projectStages]);

  const completedProjectCount = useMemo(
    () => (kind === "project" ? projects.filter((p) => isCompletedProjectStatus(p.status, projectStages)).length : 0),
    [kind, projects, projectStages],
  );

  return (
    <Screen
      onRefresh={load}
      refreshing={refreshing}
      stickyTop={<Field label="Ara" value={q} onChangeText={setQ} placeholder="No / cari / ad" />}
    >
      {canEdit ? (
        <PrimaryButton title={newButtonLabel(kind)} onPress={() => go(meta.goNew)} color={colors.primary} testID={`new-${kind}-btn`} />
      ) : null}
      {kind === "project" && completedProjectCount ? (
        <>
          <PrimaryButton
            title={showCompleted ? "Tamamlananları gizle" : `Tamamlananları göster (${completedProjectCount})`}
            onPress={() => setShowCompleted((v) => !v)}
            color={colors.secondary}
            testID="toggle-completed-projects"
          />
          {!showCompleted ? (
            <Muted testID="completed-projects-hint">{completedProjectCount} tamamlanan proje gizlendi.</Muted>
          ) : null}
        </>
      ) : null}
      <ErrorBanner message={error} />
      {!filtered.length ? (
        <Empty
          icon={meta.icon}
          title={!companyId || (refreshing && !quotes.length && !projects.length && !surveys.length) ? "Yükleniyor…" : meta.empty}
          hint={
            !companyId || (refreshing && !quotes.length && !projects.length && !surveys.length)
              ? "Kayıtlar getiriliyor."
              : kind === "project" && completedProjectCount && !showCompleted
              ? "Açık proje yok — tamamlananları göstermek için üstteki düğmeyi kullanın."
              : canEdit ? `${newButtonLabel(kind)} ile başlayın.` : undefined
          }
        />
      ) : kind === "project" ? (
        <ProjectCardsHost
          projects={filtered.map((r) => r.project!)}
          stages={projectStages}
          canEdit={canEdit}
          canExp={canExp}
          canQuote={canQuote}
          client={client}
          companyId={companyId}
          baseUrl={baseUrl}
          onPatch={patchProject}
          onError={setError}
          onCollect={canBank ? (project) => {
            const cid = String(project.contact_id || "");
            if (!cid) { setError("Bu projenin carisi yok."); return; }
            go("ContactDetail", { id: cid, name: project.contact_name || "", collect: "1" });
          } : undefined}
        />
      ) : filtered.map((r) => (
        <ListRow
          key={r.id}
          testID={`${kind}-row-${r.id}`}
          title={r.quote ? <QuoteListHeading quote={r.quote} /> : r.survey ? <SurveyListHeading survey={r.survey} /> : r.title}
          subtitle={r.subtitle}
          right={r.right || undefined}
          onPress={() => go(meta.goDetail, { id: r.id })}
          action={r.survey ? <SurveyMapsLink survey={r.survey} /> : undefined}
        />
      ))}
    </Screen>
  );
}

function SurveyListHeading({ survey }: { survey: Pick<SurveyDoc, "survey_number" | "status" | "quote_id"> }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <Text style={{ fontWeight: "700", color: colors.text, fontSize: 14 }} numberOfLines={1}>
        {survey.survey_number || "Keşif"}
      </Text>
      {!isSurveyConverted(survey) ? (
        <View testID="survey-status-badge">
          <Badge label={statusTr(survey.status)} tone={surveyStatusTone(survey.status)} />
        </View>
      ) : null}
    </View>
  );
}

function QuoteListHeading({ quote }: { quote: Pick<QuoteDoc, "contact_name" | "status" | "valid_until"> }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      <Text style={{ fontWeight: "700", color: colors.text, fontSize: 14 }} numberOfLines={1}>
        {quote.contact_name || "—"}
      </Text>
      <View testID="quote-status-badge">
        <Badge label={statusTr(quote.status)} tone={quoteStatusTone(quote.status)} />
      </View>
      {quote.valid_until ? (
        <Text style={{ fontWeight: "700", color: colors.text, fontSize: 14 }}>{fmtDate(quote.valid_until)}</Text>
      ) : null}
    </View>
  );
}

function SurveyMapsLink({ survey }: { survey: SurveyDoc }) {
  const href = mapsLink(survey);
  if (!href) return null;
  return (
    <Pressable
      testID={`survey-maps-${idOf(survey)}`}
      onPress={() => openWorkLocation(survey, "Bu keşfe konum veya adres eklenmemiş.")}
      hitSlop={8}
      style={{ flexShrink: 0, paddingHorizontal: 2 }}
    >
      <Text style={{ fontWeight: "800", color: "#9F1239", fontSize: 12 }}>{SURVEY_MAPS_ACTION}</Text>
    </Pressable>
  );
}
