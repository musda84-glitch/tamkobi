import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Platform, Pressable, Share, Text, View } from "react-native";
import { get, post, put } from "../api/client";
import { normalizeApiBase } from "../api/url";
import { apiErrorMessage, useAuth } from "../auth/AuthContext";
import { B2BSheet } from "../components/b2b/B2BSheet";
import { ProjectStagePhotos, ProjectWorkPreview } from "../components/ProjectStagePhotos";
import { Chip } from "../components/chips";
import { GroupedSelect } from "../components/GroupedSelect";
import { Badge, Card, Empty, ErrorBanner, Field, ListRow, Muted, PrimaryButton, Row, Screen } from "../components/kit";
import { go } from "../nav";
import { colors } from "../theme";
import { statusTr } from "../utils/labels";
import { fmtDate, fmtMoney, idOf } from "../utils/money";
import { mapsLink } from "../utils/geo";
import { isCompletedProjectStatus, normalizeProjectStages, type ProjectStage } from "../utils/projectStages";
import type { Employee, ProjectTask } from "../utils/personnel";
import {
  approvalChannels,
  approvalPublicOrigin,
  channelResultLabel,
  defaultApprovalFlags,
  validateApprovalSend,
} from "../utils/quoteApproval";
import {
  PROJECT_QUOTE_ACTION,
  PROJECT_NEW_QUOTE_ACTION,
  PROJECT_MAPS_ACTION,
  SURVEY_MAPS_ACTION,
  projectQuoteNavParams,
  canCompleteProject,
  applyTaskAssignee,
  assigneeSelectGroups,
  cleanProjectTasks,
  emptyProjectTask,
  newButtonLabel,
  projectCardBits,
  projectStatusSelectGroups,
  projectTaskRows,
  projectTaskSummary,
  projectTrackingPayload,
  quoteListSubtitle,
  quoteListTitle,
  quoteStatusTone,
  isSurveyConverted,
  surveyListSubtitle,
  surveyStatusTone,
  trackingAbsoluteLink,
  trackingBadgeLabel,
  trackingShareMessage,
  type ProjectDoc,
  type ProjectTrackingResult,
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
  const [quotes, setQuotes] = useState<QuoteDoc[]>([]);
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [surveys, setSurveys] = useState<SurveyDoc[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [teamProject, setTeamProject] = useState<ProjectDoc | null>(null);
  const [trackProject, setTrackProject] = useState<ProjectDoc | null>(null);
  const [previewProject, setPreviewProject] = useState<ProjectDoc | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [projectStages, setProjectStages] = useState<ProjectStage[]>([]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      if (kind === "quote") {
        const rows = await get<QuoteDoc[]>(client, "/quotes", { company_id: companyId, summary: 1 });
        setQuotes(rows || []);
      } else if (kind === "project") {
        const [rows, stages] = await Promise.all([
          get<ProjectDoc[]>(client, "/projects", { company_id: companyId, light: 1 }),
          get<{ stages?: ProjectStage[] }>(client, `/companies/${companyId}/project-stages`).catch(() => ({ stages: [] })),
        ]);
        setProjects(rows || []);
        setProjectStages(normalizeProjectStages(stages?.stages));
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

  const patchProject = useCallback((id: string, patch: Partial<ProjectDoc>) => {
    setProjects((rows) => rows.map((p) => (idOf(p) === id ? { ...p, ...patch } : p)));
    setTeamProject((cur) => (cur && idOf(cur) === id ? { ...cur, ...patch } : cur));
    setTrackProject((cur) => (cur && idOf(cur) === id ? { ...cur, ...patch } : cur));
  }, []);

  const setProjectStatus = async (id: string, status: string) => {
    const current = projects.find((p) => idOf(p) === id);
    if (!current || current.status === status || statusBusyId) return;
    setStatusBusyId(id);
    try {
      await put(client, `/projects/${id}`, { status });
      patchProject(id, { status });
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Aşama güncellenemedi."));
    } finally {
      setStatusBusyId(null);
    }
  };

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
    <Screen onRefresh={load} refreshing={refreshing}>
      {canEdit ? (
        <PrimaryButton title={newButtonLabel(kind)} onPress={() => go(meta.goNew)} color={colors.primary} testID={`new-${kind}-btn`} />
      ) : null}
      <Field label="Ara" value={q} onChangeText={setQ} placeholder="No / cari / ad" />
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
          title={meta.empty}
          hint={
            kind === "project" && completedProjectCount && !showCompleted
              ? "Açık proje yok — tamamlananları göstermek için üstteki düğmeyi kullanın."
              : canEdit ? `${newButtonLabel(kind)} ile başlayın.` : undefined
          }
        />
      ) : kind === "project" ? filtered.map((r) => (
        <ProjectCard
          key={r.id}
          project={r.project!}
          stages={projectStages}
          canEdit={canEdit}
          canExp={canExp}
          canQuote={canQuote}
          statusBusy={statusBusyId === r.id}
          onStatus={(status) => setProjectStatus(r.id, status)}
          onTeam={() => setTeamProject(r.project!)}
          onTrack={() => setTrackProject(r.project!)}
          onPhotos={(id, patch) => patchProject(id, patch)}
          onPreview={() => setPreviewProject(r.project!)}
        />
      )) : filtered.map((r) => (
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
      <ProjectTeamSheet
        visible={!!teamProject}
        project={teamProject}
        client={client}
        companyId={companyId}
        onClose={() => setTeamProject(null)}
        onSaved={(id, tasks) => {
          patchProject(id, { tasks });
          setTeamProject(null);
        }}
        onError={setError}
      />
      <ProjectTrackSheet
        visible={!!trackProject}
        project={trackProject}
        client={client}
        baseUrl={baseUrl}
        onClose={() => setTrackProject(null)}
        onMinted={(id, tracking) => patchProject(id, { tracking })}
        onError={setError}
      />
      <B2BSheet
        visible={!!previewProject}
        title="Yapılan işler"
        subtitle={previewProject ? `${previewProject.contact_name || "Müşteri"} · takip linkinde böyle görünür` : undefined}
        onClose={() => setPreviewProject(null)}
        testID="project-work-preview-sheet"
      >
        {previewProject ? (
          <ProjectWorkPreview
            project={projects.find((p) => idOf(p) === idOf(previewProject)) || previewProject}
            stages={projectStages}
          />
        ) : null}
      </B2BSheet>
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

function Metric({
  label,
  value,
  testID,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  testID?: string;
  tone?: "green" | "rose";
  onPress?: () => void;
}) {
  const color = tone === "green" ? colors.primaryHover : tone === "rose" ? colors.danger : colors.text;
  const body = (
    <View style={{ flex: 1, backgroundColor: colors.slate50, borderRadius: 10, padding: 8, minWidth: 0 }}>
      <Muted>{label}</Muted>
      <Text testID={testID} numberOfLines={1} style={{ fontWeight: "800", fontSize: 12, color }}>{value}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable style={{ flex: 1, minWidth: 0 }} onPress={onPress} testID={testID ? `${testID}-open` : undefined}>
      {body}
    </Pressable>
  );
}

function ActionBtn({
  title,
  onPress,
  testID,
  bg,
  border,
  color,
}: {
  title: string;
  onPress: () => void;
  testID: string;
  bg: string;
  border?: string;
  color: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 40,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        borderWidth: border ? 1 : 0,
        borderColor: border,
        paddingHorizontal: 8,
      }}
    >
      <Text style={{ fontWeight: "800", color, fontSize: 12 }}>{title}</Text>
    </Pressable>
  );
}

function openWorkLocation(row: { location_url?: string | null; latitude?: number | null; longitude?: number | null; address?: string | null }, emptyMsg: string) {
  const href = mapsLink(row);
  if (!href) {
    Alert.alert("Konum yok", emptyMsg);
    return;
  }
  Linking.openURL(href).catch(() => Alert.alert("Harita açılamadı", "Konum linki açılamadı."));
}

function openProjectLocation(project: ProjectDoc) {
  openWorkLocation(project, "Bu projeye konum veya adres eklenmemiş.");
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

function ProjectCard({
  project,
  stages,
  canEdit,
  canExp,
  canQuote,
  statusBusy,
  onStatus,
  onTeam,
  onTrack,
  onPhotos,
  onPreview,
}: {
  project: ProjectDoc;
  stages: ProjectStage[];
  canEdit: boolean;
  canExp: boolean;
  canQuote: boolean;
  statusBusy: boolean;
  onStatus: (status: string) => void;
  onTeam: () => void;
  onTrack: () => void;
  onPhotos: (id: string, patch: Pick<ProjectDoc, "stage_photos" | "images">) => void;
  onPreview: () => void;
}) {
  const id = idOf(project);
  const bits = projectCardBits(project);
  const taskBits = projectTaskSummary(project.tasks);
  const trackLabel = trackingBadgeLabel(project.tracking);
  return (
    <Card testID={`project-row-${id}`}>
      <Pressable onPress={() => go("ProjectDetail", { id })}>
        {bits.codes ? <Muted>{bits.codes}</Muted> : null}
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <Text style={{ flex: 1, fontWeight: "800", color: colors.text, fontSize: 15 }} numberOfLines={2}>{bits.name}</Text>
          <Badge
            label={statusTr(project.status)}
            tone={project.status === "completed" ? "green" : project.status === "on_hold" ? "amber" : project.status === "active" ? "indigo" : "slate"}
          />
        </Row>
        <Muted>{bits.contact}</Muted>
      </Pressable>
      <Row style={{ alignItems: "stretch", gap: 6, marginTop: 4 }}>
        <Metric label="Bütçe" value={fmtMoney(bits.budget)} testID={`project-budget-${id}`} onPress={() => go("ProjectDetail", { id })} />
        <Metric
          label="Teklif"
          value={`${bits.quoteCount} · ${fmtMoney(bits.quoted)}`}
          testID={`project-quoted-${id}`}
          onPress={() => go("ProjectDetail", { id, section: "quotes" })}
        />
      </Row>
      <Row style={{ alignItems: "stretch", gap: 6, marginTop: 6 }}>
        <Metric
          label="Faturalanan"
          value={fmtMoney(bits.invoiced)}
          testID={`project-invoiced-${id}`}
          tone="green"
          onPress={() => go("ProjectDetail", { id, section: "invoices" })}
        />
        <Metric
          label="Masraf"
          value={fmtMoney(bits.expense)}
          testID={`project-expense-total-${id}`}
          tone="rose"
          onPress={() => go("ProjectDetail", { id, section: "expenses" })}
        />
      </Row>
      {taskBits || trackLabel ? (
        <Pressable onPress={() => go("ProjectDetail", { id })}>
          <Row style={{ flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {taskBits ? (
              <View testID={`project-tasks-${id}`} style={{ backgroundColor: colors.indigo50, borderRadius: 8, borderWidth: 1, borderColor: "#C7D2FE", paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ fontWeight: "700", color: "#3730A3", fontSize: 11 }}>{taskBits.label}</Text>
              </View>
            ) : null}
            {trackLabel ? (
              <View testID={`project-track-badge-${id}`} style={{ backgroundColor: "#F0F9FF", borderRadius: 8, borderWidth: 1, borderColor: "#BAE6FD", paddingHorizontal: 8, paddingVertical: 4 }}>
                <Text style={{ fontWeight: "700", color: "#0369A1", fontSize: 11 }}>{trackLabel}</Text>
              </View>
            ) : null}
          </Row>
        </Pressable>
      ) : null}
      {canEdit ? (
        <View style={{ marginTop: 8 }}>
          <GroupedSelect
            dense
            label="Aşama"
            testID={`project-status-${id}`}
            value={project.status || "planning"}
            onChange={(v) => !statusBusy && onStatus(v)}
            groups={projectStatusSelectGroups(project.status)}
            emptyLabel="Aşama seçin"
          />
        </View>
      ) : null}
      <ProjectStagePhotos
        project={project}
        stages={stages}
        editable={canEdit}
        onChanged={(patch) => onPhotos(id, patch)}
        onPreview={onPreview}
        testID={`project-stage-photos-${id}`}
      />
      <View style={{ gap: 6, marginTop: 8 }}>
        <Row style={{ flexWrap: "wrap" }}>
          {canQuote ? (
            <ActionBtn
              title={PROJECT_NEW_QUOTE_ACTION}
              testID={`project-new-quote-${id}`}
              onPress={() => go("QuoteNew", projectQuoteNavParams(project))}
              bg="#FFFBEB"
              border="#FDE68A"
              color="#92400E"
            />
          ) : null}
          <ActionBtn
            title={PROJECT_MAPS_ACTION}
            testID={`project-maps-${id}`}
            onPress={() => openProjectLocation(project)}
            bg="#FFF1F2"
            border="#FECDD3"
            color="#9F1239"
          />
        </Row>
        {canExp || canEdit ? (
          <Row style={{ flexWrap: "wrap" }}>
            {canExp ? (
              <ActionBtn
                title="Masraf Ekle"
                testID={`project-expense-${id}`}
                onPress={() => go("ProjectDetail", { id, open_expense: "1" })}
                bg={colors.rose50}
                border="#FECDD3"
                color="#9F1239"
              />
            ) : null}
            {canEdit ? (
              <ActionBtn
                title="Görev Ata"
                testID={`project-team-${id}`}
                onPress={onTeam}
                bg={colors.indigo50}
                border="#C7D2FE"
                color="#3730A3"
              />
            ) : null}
          </Row>
        ) : null}
        {canEdit ? (
          <Row style={{ flexWrap: "wrap" }}>
            <ActionBtn
              title="Takip Linki"
              testID={`project-track-${id}`}
              onPress={onTrack}
              bg={colors.emerald50}
              border="#A7F3D0"
              color="#047857"
            />
            {canCompleteProject(project.status) ? (
              <ActionBtn
                title={PROJECT_QUOTE_ACTION}
                testID={`project-quote-${id}`}
                onPress={() => !statusBusy && onStatus("completed")}
                bg={colors.primary}
                color="#fff"
              />
            ) : null}
          </Row>
        ) : null}
      </View>
    </Card>
  );
}

function ProjectTeamSheet({
  visible,
  project,
  client,
  companyId,
  onClose,
  onSaved,
  onError,
}: {
  visible: boolean;
  project: ProjectDoc | null;
  client: { baseUrl: string; token: string | null };
  companyId: string;
  onClose: () => void;
  onSaved: (id: string, tasks: ProjectTask[]) => void;
  onError: (msg: string) => void;
}) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !project) return;
    let cancelled = false;
    setTasks(projectTaskRows(project.tasks));
    setLocalError(null);
    setLoading(true);
    (async () => {
      try {
        const emps = await get<Employee[]>(client, "/personnel/employees", { company_id: companyId });
        if (!cancelled) setEmployees(emps || []);
      } catch (err) {
        if (!cancelled) {
          setEmployees([]);
          setLocalError(apiErrorMessage(err, "Personel listesi yüklenemedi."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, project, client, companyId]);

  const save = async () => {
    if (!project) return;
    const id = idOf(project);
    const cleaned = cleanProjectTasks(tasks);
    setBusy(true);
    try {
      await put(client, `/projects/${id}`, { tasks: cleaned });
      onSaved(id, cleaned);
    } catch (err) {
      onError(apiErrorMessage(err, "Görevler kaydedilemedi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <B2BSheet
      visible={visible}
      title="Görev ata"
      subtitle={project ? `${project.name || "Proje"}${project.project_number ? ` · ${project.project_number}` : ""}` : undefined}
      onClose={onClose}
      testID="project-team-sheet"
    >
      <ErrorBanner message={localError} />
      {loading ? <Muted>Personel yükleniyor…</Muted> : null}
      {tasks.map((t, i) => (
        <View
          key={t.id || `task-${i}`}
          testID={`project-task-row-${i}`}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, marginBottom: 8, backgroundColor: colors.slate50, gap: 8 }}
        >
          <Row style={{ alignItems: "center", gap: 8 }}>
            <Pressable
              testID={`project-task-done-${i}`}
              onPress={() => setTasks((rows) => rows.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
              hitSlop={8}
            >
              <Ionicons name={t.done ? "checkbox" : "square-outline"} size={22} color={t.done ? colors.primary : colors.muted} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Field
                dense
                label="Görev"
                testID={`project-task-title-${i}`}
                value={t.title || ""}
                onChangeText={(title) => setTasks((rows) => rows.map((x, j) => (j === i ? { ...x, title } : x)))}
                placeholder="Keşif, montaj…"
              />
            </View>
            <Pressable
              testID={`project-task-del-${i}`}
              onPress={() => setTasks((rows) => (rows.length > 1 ? rows.filter((_, j) => j !== i) : [emptyProjectTask()]))}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </Row>
          <GroupedSelect
            dense
            label="Personel"
            testID={`project-task-assignee-${i}`}
            value={t.assignee_id || ""}
            onChange={(v) => setTasks((rows) => rows.map((x, j) => (j === i ? applyTaskAssignee(x, employees, v) : x)))}
            groups={assigneeSelectGroups(employees)}
            emptyLabel="Personel seçin"
          />
        </View>
      ))}
      <Pressable
        testID="project-task-add"
        onPress={() => setTasks((rows) => [...rows, emptyProjectTask()])}
        style={{ minHeight: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#C7D2FE", backgroundColor: colors.indigo50, marginBottom: 10 }}
      >
        <Text style={{ fontWeight: "800", color: "#3730A3", fontSize: 13 }}>Görev ekle</Text>
      </Pressable>
      <PrimaryButton title="Dağılımı Kaydet" testID="project-team-save" color={colors.indigo} loading={busy} onPress={save} />
    </B2BSheet>
  );
}

function shareOrCopy(value: string) {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(value).catch(() => Share.share({ message: value }));
    return;
  }
  Share.share({ message: value }).catch(() => null);
}

function ProjectTrackSheet({
  visible,
  project,
  client,
  baseUrl,
  onClose,
  onMinted,
  onError,
}: {
  visible: boolean;
  project: ProjectDoc | null;
  client: { baseUrl: string; token: string | null };
  baseUrl: string;
  onClose: () => void;
  onMinted: (id: string, tracking: ProjectDoc["tracking"]) => void;
  onError: (msg: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [flags, setFlags] = useState(defaultApprovalFlags("", ""));
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [result, setResult] = useState<ProjectTrackingResult | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPhone("");
    setEmail("");
    setFlags(defaultApprovalFlags("", ""));
    setLocalError(null);
    setResult(null);
  }, [visible, project]);

  const origin = approvalPublicOrigin(normalizeApiBase(baseUrl), project?.tracking?.link);
  const link = trackingAbsoluteLink(project?.tracking, result, baseUrl);

  const send = async (channels: string[]) => {
    if (!project) return;
    if (channels.length) {
      const invalid = validateApprovalSend(channels, phone, email);
      if (invalid) { setLocalError(invalid); return; }
    }
    const id = idOf(project);
    setBusy(true);
    try {
      const res = await post<ProjectTrackingResult>(client, `/projects/${id}/send-tracking`, projectTrackingPayload(channels, phone, email, origin));
      setResult(res);
      onMinted(id, {
        ...(project.tracking || {}),
        token: res.token,
        link: res.link,
        sent_count: (project.tracking?.sent_count || 0) + (channels.length ? 1 : 0),
      });
      setLocalError(null);
    } catch (err) {
      onError(apiErrorMessage(err, "Takip linki oluşturulamadı."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <B2BSheet
      visible={visible}
      title="Takip linki"
      subtitle={project ? `${project.contact_name || "Müşteri"} · giriş gerektirmez` : undefined}
      onClose={onClose}
      testID="project-track-sheet"
    >
      <ErrorBanner message={localError} />
      <Muted>SMS, WhatsApp veya e-posta ile gönderin; ya da yalnız link üretin. Aşama fotoğrafları müşteri sayfasında “Yapılan işler” olarak görünür.</Muted>
      <Row style={{ flexWrap: "wrap", gap: 6, marginVertical: 8 }}>
        {(["sms", "email", "whatsapp"] as const).map((k) => (
          <Chip
            key={k}
            compact
            label={k === "sms" ? "SMS" : k === "email" ? "E-posta" : "WhatsApp"}
            active={!!flags[k]}
            onPress={() => setFlags((f) => ({ ...f, [k]: !f[k] }))}
            testID={`track-ch-${k}`}
          />
        ))}
      </Row>
      <Field dense label="Telefon" testID="track-phone" value={phone} onChangeText={setPhone} placeholder="05XX…" keyboardType="phone-pad" />
      <Field dense label="E-posta" testID="track-email" value={email} onChangeText={setEmail} placeholder="musteri@firma.com" autoCapitalize="none" keyboardType="email-address" />
      {link ? (
        <View testID="track-result" style={{ backgroundColor: colors.slate50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, marginVertical: 8, gap: 6 }}>
          <Muted>Takip linki</Muted>
          <Text testID="track-link" selectable style={{ fontWeight: "700", color: colors.primaryHover, fontSize: 12 }}>{link}</Text>
          <Row style={{ gap: 8 }}>
            <ActionBtn title="Paylaş" testID="track-share" onPress={() => shareOrCopy(trackingShareMessage(project || {}, link))} bg={colors.emerald50} border="#A7F3D0" color="#047857" />
            <ActionBtn title="Aç" testID="track-preview" onPress={() => Linking.openURL(link).catch(() => null)} bg="#fff" border={colors.border} color={colors.text} />
          </Row>
          {result?.results
            ? Object.entries(result.results).map(([k, v]) => (
              <Muted key={k}>{k}: {channelResultLabel(v.status)}{v.detail ? ` · ${v.detail}` : ""}</Muted>
            ))
            : null}
        </View>
      ) : null}
      <Row style={{ gap: 8, marginTop: 8 }}>
        <View style={{ flex: 1 }}>
          <PrimaryButton title="Sadece link üret" testID="track-mint" color={colors.slate800} loading={busy} onPress={() => send([])} />
        </View>
        <View style={{ flex: 1 }}>
          <PrimaryButton
            title={(project?.tracking?.sent_count || 0) > 0 ? "Tekrar Gönder" : "Gönder"}
            testID="track-send"
            color={colors.primary}
            loading={busy}
            onPress={() => send(approvalChannels(flags))}
          />
        </View>
      </Row>
    </B2BSheet>
  );
}
